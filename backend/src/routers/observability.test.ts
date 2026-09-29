import { describe, expect, it, vi } from 'vitest'

const sendToAxiomMock = vi.fn().mockResolvedValue(undefined)
vi.mock('../lib/observability/axiom.js', () => ({
  sendToAxiom: sendToAxiomMock,
  axiomEnvelope: () => ({ _time: '2024-01-01T00:00:00.000Z', env: 'test' }),
}))

describe('observability router', () => {
  it('accepts a client error report with no session at all', async () => {
    const { observabilityRouter } = await import('./observability.js')
    // Public procedure: an empty context is exactly what a failed sign-in has.
    const caller = observabilityRouter.createCaller({} as never)

    const result = await caller.reportClientError({ scope: 'auth-sign-in', message: 'fetch failed', name: 'TypeError' })

    expect(result).toEqual({ ok: true })
  })

  it('tags a report with no session as unverified, since anyone who knows the URL can hit it', async () => {
    sendToAxiomMock.mockClear()
    const { observabilityRouter } = await import('./observability.js')
    const caller = observabilityRouter.createCaller({} as never)

    await caller.reportClientError({ scope: 'auth-sign-in', message: 'The network connection was lost.' })

    expect(sendToAxiomMock).toHaveBeenCalledTimes(1)
    const [events] = sendToAxiomMock.mock.calls[0]
    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({
      service: 'tofi-frontend-unverified',
      level: 'error',
      scope: 'auth-sign-in',
      err: { type: 'Error', message: 'The network connection was lost.' },
    })
    expect(events[0]).not.toHaveProperty('userId')
  })

  it('attributes a report from a still-signed-in user rather than treating them as anonymous', async () => {
    sendToAxiomMock.mockClear()
    const { observabilityRouter } = await import('./observability.js')
    // Public doesn't mean the context is empty: createContext resolves userId from the bearer
    // token whenever one is present, regardless of whether the procedure requires it.
    const caller = observabilityRouter.createCaller({ userId: 'user-1', email: null, jwt: 'jwt-1' } as never)

    await caller.reportClientError({ scope: 'transaction-sync', message: 'fetch failed' })

    const [events] = sendToAxiomMock.mock.calls[0]
    expect(events[0]).toMatchObject({ service: 'tofi-frontend', userId: 'user-1' })
  })

  it('rejects an empty scope or message rather than logging a blank line', async () => {
    const { observabilityRouter } = await import('./observability.js')
    const caller = observabilityRouter.createCaller({} as never)

    await expect(caller.reportClientError({ scope: '', message: 'x' })).rejects.toThrow()
    await expect(caller.reportClientError({ scope: 'x', message: '' })).rejects.toThrow()
  })
})
