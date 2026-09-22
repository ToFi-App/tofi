import { describe, expect, it, vi } from 'vitest'
import { REDACTED_MESSAGE, logTrpcError, redactInternalMessage, toAxiomEvent } from './errorLogging.js'

function fakeLog() {
  return { warn: vi.fn(), error: vi.fn() }
}

function trpcError(code: string, message: string, cause?: unknown) {
  return { code, message, name: 'TRPCError', stack: 'stack here', cause } as never
}

describe('logTrpcError', () => {
  it('logs an unexpected failure at error level with the procedure that failed', () => {
    const log = fakeLog()
    logTrpcError(log, { error: trpcError('INTERNAL_SERVER_ERROR', 'db is down'), path: 'accounts.list', type: 'query' })

    expect(log.error).toHaveBeenCalledTimes(1)
    expect(log.warn).not.toHaveBeenCalled()
    const [detail, message] = log.error.mock.calls[0]
    expect(message).toBe('trpc procedure failed')
    expect(detail.trpc).toEqual({ path: 'accounts.list', type: 'query', code: 'INTERNAL_SERVER_ERROR' })
    expect(detail.err).toBeDefined()
  })

  it('logs an expected rejection at warn level so real failures stay findable', () => {
    const log = fakeLog()
    // A signed-out client polling is normal traffic, not an incident.
    logTrpcError(log, { error: trpcError('UNAUTHORIZED', 'UNAUTHORIZED'), path: 'accounts.list', type: 'query' })

    expect(log.warn).toHaveBeenCalledTimes(1)
    expect(log.error).not.toHaveBeenCalled()
  })

  it('surfaces the Plaid error code from the cause, which the message never carries', () => {
    const log = fakeLog()
    // A failed Plaid call rejects with an axios error whose message is only
    // "Request failed with status code 400" — the diagnosis lives in the response body.
    const cause = Object.assign(new Error('Request failed with status code 400'), {
      response: { data: { error_type: 'ITEM_ERROR', error_code: 'ITEM_LOGIN_REQUIRED' } },
    })
    logTrpcError(log, {
      error: trpcError('INTERNAL_SERVER_ERROR', 'Request failed with status code 400', cause),
      path: 'transactions.sync',
      type: 'mutation',
    })

    expect(log.error.mock.calls[0][0].plaid).toEqual({ errorType: 'ITEM_ERROR', errorCode: 'ITEM_LOGIN_REQUIRED' })
  })

  it('omits the plaid field entirely when the cause is not a Plaid error', () => {
    const log = fakeLog()
    logTrpcError(log, { error: trpcError('INTERNAL_SERVER_ERROR', 'boom'), path: 'budgets.list', type: 'query' })
    expect(log.error.mock.calls[0][0].plaid).toBeUndefined()
  })

  it('tags a network connectivity failure so it reads as a platform outage, not our bug', () => {
    const log = fakeLog()
    // What a dropped direct-Postgres connection actually throws (backend/src/lib/db/client.ts).
    const cause = Object.assign(new Error('connect ECONNREFUSED 127.0.0.1:5432'), { code: 'ECONNREFUSED' })
    logTrpcError(log, {
      error: trpcError('INTERNAL_SERVER_ERROR', 'connect ECONNREFUSED 127.0.0.1:5432', cause),
      path: 'plaidCredentials.get',
      type: 'query',
    })

    const detail = log.error.mock.calls[0][0]
    // Not "supabase": a generic connection-refused code carries no signal about which
    // downstream call failed, so it's tagged as what it verifiably is, nothing more specific.
    expect(detail.dependency).toBe('network')
    expect(detail.dependencyReason).toBe('ECONNREFUSED')
  })

  it('logs an UNAUTHORIZED caused by a stalled JWKS fetch at error level, not warn', () => {
    const log = fakeLog()
    // trpc.ts's protectedProcedure attaches this cause when ctx.authError is set — the JWKS
    // timeout that caused the token to fail verification, not the token itself being bad.
    const cause = Object.assign(new Error('request timed out'), { code: 'ERR_JWKS_TIMEOUT' })
    logTrpcError(log, {
      error: trpcError('UNAUTHORIZED', 'UNAUTHORIZED', cause),
      path: 'accounts.list',
      type: 'query',
    })

    // An UNAUTHORIZED with this cause means auth verification itself is down, not that a
    // signed-out client is polling — the routine case this code is normally warn-level for.
    expect(log.warn).not.toHaveBeenCalled()
    expect(log.error).toHaveBeenCalledTimes(1)
    const detail = log.error.mock.calls[0][0]
    expect(detail.dependency).toBe('network')
    expect(detail.dependencyReason).toBe('ERR_JWKS_TIMEOUT')
  })

  it('omits the dependency field for an application-level failure, even one touching the database', () => {
    const log = fakeLog()
    // A real bug (bad query, RLS rejection) completed the round trip — tagging it a network
    // failure would hide our own defect behind what looks like a platform incident.
    const cause = Object.assign(new Error('duplicate key value violates unique constraint'), { code: '23505' })
    logTrpcError(log, {
      error: trpcError('INTERNAL_SERVER_ERROR', 'duplicate key value violates unique constraint', cause),
      path: 'transfers.create',
      type: 'mutation',
    })
    expect(log.error.mock.calls[0][0].dependency).toBeUndefined()
  })

  it('never logs the procedure input', () => {
    const log = fakeLog()
    // Constraint 11: raw Plaid data must not be persisted server-side, and a log line is
    // persistence. Inputs carry cursors, amounts and transaction ids, so they stay out.
    logTrpcError(log, {
      error: trpcError('INTERNAL_SERVER_ERROR', 'boom'),
      path: 'transactions.sync',
      type: 'mutation',
      input: { cursors: { 'item-1': 'secret-cursor' } },
      userId: 'user-1',
    })

    const serialized = JSON.stringify(log.error.mock.calls[0][0])
    expect(serialized).not.toContain('secret-cursor')
    expect(serialized).not.toContain('cursors')
    // The user id is kept: an opaque uuid is what makes a report traceable, and it is not
    // financial data.
    expect(log.error.mock.calls[0][0].userId).toBe('user-1')
  })

  it('tolerates a request with no resolved path', () => {
    const log = fakeLog()
    logTrpcError(log, { error: trpcError('PARSE_ERROR', 'bad json'), type: 'unknown' })
    expect(log.error.mock.calls[0][0].trpc.path).toBe('<unknown>')
  })
})

describe('redactInternalMessage', () => {
  it('replaces an internal error message that would otherwise reach the client', () => {
    const shape = { message: 'could not reach db at 10.0.0.5:5432', code: -32603, data: { httpStatus: 500 } }
    expect(redactInternalMessage(shape, 'INTERNAL_SERVER_ERROR')).toEqual({ ...shape, message: REDACTED_MESSAGE })
  })

  it('leaves deliberate user-facing messages alone', () => {
    // Everything the app shows a user is thrown as a typed TRPCError precisely so it survives
    // this filter; anything untyped is a bug or a misconfiguration and says nothing useful.
    for (const code of ['BAD_REQUEST', 'NOT_FOUND', 'UNAUTHORIZED', 'PRECONDITION_FAILED']) {
      const shape = { message: 'Built-in categories cannot be renamed.', code: -32600, data: {} }
      expect(redactInternalMessage(shape, code).message).toBe('Built-in categories cannot be renamed.')
    }
  })
})

describe('toAxiomEvent', () => {
  const event = {
    error: Object.assign(new Error('db is down'), { code: 'INTERNAL_SERVER_ERROR' }) as never,
    path: 'accounts.list',
    type: 'query',
    userId: 'user-1',
    input: { cursors: { 'item-1': 'secret-cursor' } },
  }

  it('carries the same description the log line uses, plus what a log store needs to slice on', () => {
    const sent = toAxiomEvent(event, { requestId: 'req-7' }) as Record<string, unknown>

    expect(sent._time).toEqual(expect.any(String))
    expect(sent.level).toBe('error')
    expect(sent.service).toBe('tofi-backend')
    expect(sent.env).toEqual(expect.any(String))
    expect(sent.requestId).toBe('req-7')
    expect(sent.trpc).toEqual({ path: 'accounts.list', type: 'query', code: 'INTERNAL_SERVER_ERROR' })
    expect(sent.userId).toBe('user-1')
  })

  it('flattens the error, which JSON.stringify would otherwise drop entirely', () => {
    const sent = toAxiomEvent(event, {}) as { err: Record<string, unknown> }
    // An Error serializes to {} — losing the message and stack is exactly the failure this whole
    // change is meant to prevent.
    expect(sent.err.message).toBe('db is down')
    expect(sent.err.stack).toEqual(expect.any(String))
    expect(sent.err.type).toBe('Error')
  })

  it('marks an expected rejection as a warning so it can be filtered out of alerts', () => {
    const sent = toAxiomEvent({ error: { code: 'UNAUTHORIZED', message: 'nope' } as never, type: 'query' }, {})
    expect((sent as { level: string }).level).toBe('warn')
  })

  it('never sends the procedure input', () => {
    // Same constraint as the log line: an ingested event is stored, and inputs carry cursors,
    // amounts and transaction ids.
    expect(JSON.stringify(toAxiomEvent(event, {}))).not.toContain('secret-cursor')
  })

  it('includes the plaid error code when the cause is a plaid rejection', () => {
    const sent = toAxiomEvent(
      {
        error: Object.assign(new Error('Request failed with status code 400'), {
          code: 'INTERNAL_SERVER_ERROR',
          cause: { response: { data: { error_type: 'ITEM_ERROR', error_code: 'ITEM_LOGIN_REQUIRED' } } },
        }) as never,
        path: 'transactions.sync',
        type: 'mutation',
      },
      {},
    ) as { plaid: Record<string, unknown> }
    expect(sent.plaid.errorCode).toBe('ITEM_LOGIN_REQUIRED')
  })
})
