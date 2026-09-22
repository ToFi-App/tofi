import { describe, expect, it } from 'vitest'
import { networkErrorOf } from './errors.js'

describe('networkErrorOf', () => {
  it('matches a dropped direct-Postgres connection by its Node error code', () => {
    const err = Object.assign(new Error('connect ECONNREFUSED 127.0.0.1:5432'), { code: 'ECONNREFUSED' })
    expect(networkErrorOf(err)).toEqual({ matched: true, reason: 'ECONNREFUSED' })
  })

  it('matches every known network error code', () => {
    for (const code of [
      'ECONNREFUSED',
      'ETIMEDOUT',
      'ENOTFOUND',
      'ECONNRESET',
      'EAI_AGAIN',
      'EPIPE',
      'ERR_JWKS_TIMEOUT',
      'ECONNABORTED',
    ]) {
      expect(networkErrorOf(Object.assign(new Error('x'), { code }))).toEqual({ matched: true, reason: code })
    }
  })

  it('matches an axios request timeout, since that\'s how the Plaid client\'s own timeout surfaces', () => {
    // What axios actually throws when lib/plaid/client.ts's baseOptions.timeout fires.
    const axiosTimeout = Object.assign(new Error('timeout of 15000ms exceeded'), { code: 'ECONNABORTED' })
    expect(networkErrorOf(axiosTimeout)).toEqual({ matched: true, reason: 'ECONNABORTED' })
  })

  it('matches postgrest-js\'s own wrapping of an aborted/timed-out request', () => {
    // What lib/supabase/*.ts's fetchWithTimeout() firing actually produces once postgrest-js
    // re-wraps it: no stable code (code is the empty string, not absent), only this message shape.
    const abortedQuery = { message: 'AbortError: This operation was aborted', code: '', hint: 'Request was aborted (timeout or manual cancellation)' }
    expect(networkErrorOf(abortedQuery)).toEqual({ matched: true, reason: abortedQuery.message })
  })

  it('matches any @supabase/auth-js failure by its own stable error class name', () => {
    // auth-js wraps every failed/aborted fetch (admin API, token refresh, sign-in) in this class
    // regardless of what failed underneath, with no reusable code or message pattern of its own.
    const authFetchError = Object.assign(new Error('AbortError'), { name: 'AuthRetryableFetchError', status: 0 })
    expect(networkErrorOf(authFetchError)).toEqual({ matched: true, reason: 'AuthRetryableFetchError' })
  })

  it('matches a stalled JWKS fetch, since jose reports that as its own error code', () => {
    // requireAuth.ts's createRemoteJWKSet surfaces exactly this shape when Supabase's own
    // /.well-known/jwks.json endpoint is slow or unreachable.
    const jwksTimeout = Object.assign(new Error('request timed out'), { code: 'ERR_JWKS_TIMEOUT', name: 'JWKSTimeout' })
    expect(networkErrorOf(jwksTimeout)).toEqual({ matched: true, reason: 'ERR_JWKS_TIMEOUT' })
  })

  it('matches a PostgREST fetch failure by message, since it carries no network error code', () => {
    expect(networkErrorOf(new Error('fetch failed'))).toEqual({ matched: true, reason: 'fetch failed' })
    expect(networkErrorOf(new Error('The network connection was lost.'))).toEqual({
      matched: true,
      reason: 'The network connection was lost.',
    })
  })

  it('matches undici\'s own "fetch failed" wrapper by the real code underneath it, not just its message', () => {
    // undici wraps the actual system error in `.cause` and gives the top-level error the bare,
    // runtime-specific message "fetch failed" — the code-based match should reach through that
    // wrapper rather than depend on the message text alone.
    const wrapped = Object.assign(new Error('fetch failed'), { cause: Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' }) })
    expect(networkErrorOf(wrapped)).toEqual({ matched: true, reason: 'ECONNREFUSED' })
  })

  it('does not match an application-level Postgres/PostgREST error', () => {
    // A real bug: a unique-violation or an RLS rejection completed the round trip and got a
    // proper answer back — tagging this as a network failure would hide our own defect.
    const constraintViolation = Object.assign(new Error('duplicate key value violates unique constraint'), {
      code: '23505',
    })
    expect(networkErrorOf(constraintViolation)).toEqual({ matched: false })

    const rlsRejection = { message: 'new row violates row-level security policy', code: '42501' }
    expect(networkErrorOf(rlsRejection)).toEqual({ matched: false })
  })

  it('does not match Postgres\'s own statement timeout, a slow query rather than a dropped connection', () => {
    // SQLSTATE 57014 — the query completed a full round trip and Postgres itself cancelled it.
    // The word "timeout" appears in the message, which is exactly why message-matching on it
    // was rejected in favor of the specific ETIMEDOUT error code.
    const statementTimeout = Object.assign(new Error('canceling statement due to statement timeout'), { code: '57014' })
    expect(networkErrorOf(statementTimeout)).toEqual({ matched: false })
  })

  it('does not match on a bare substring of unrelated text', () => {
    // A prior version matched /network/i as a bare substring; a message that merely mentions
    // "network" without indicating a dropped connection must not be tagged as one.
    expect(networkErrorOf(new Error('user requested network access to a disabled feature'))).toEqual({ matched: false })
  })

  it('does not match a non-error value or one with no message', () => {
    expect(networkErrorOf(undefined)).toEqual({ matched: false })
    expect(networkErrorOf('nope')).toEqual({ matched: false })
    expect(networkErrorOf({})).toEqual({ matched: false })
  })
})
