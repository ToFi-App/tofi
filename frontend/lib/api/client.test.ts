import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Stubbed so importing this module doesn't pull in the real native auth SDKs
// (expo-apple-authentication, google-signin) that fetchWithNetworkRetry itself never touches.
vi.mock('@/lib/supabase/auth', () => ({ supabaseAuth: { auth: { getSession: vi.fn() } } }))

import { fetchWithNetworkRetry, jitteredBackoffMs } from './client'

describe('fetchWithNetworkRetry', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('returns the response on the first try without waiting', async () => {
    const response = new Response('ok')
    const fetchMock = vi.fn().mockResolvedValue(response)
    vi.stubGlobal('fetch', fetchMock)

    await expect(fetchWithNetworkRetry('https://api.example/trpc')).resolves.toBe(response)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('retries with backoff when fetch itself rejects, then returns the eventual response', async () => {
    // Full jitter draws a random delay inside [0, ceiling) — mocking Math.random to its max
    // (just under 1) pins each wait to just under its ceiling, so a single fixed advance covers
    // it deterministically without asserting an exact delay the implementation never promises.
    vi.spyOn(Math, 'random').mockReturnValue(0.999)
    const response = new Response('ok')
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new TypeError('Network request failed'))
      .mockRejectedValueOnce(new TypeError('Network request failed'))
      .mockResolvedValueOnce(response)
    vi.stubGlobal('fetch', fetchMock)

    const promise = fetchWithNetworkRetry('https://api.example/trpc')

    // Attempt 0's ceiling is 300ms (base * 2^0).
    await vi.advanceTimersByTimeAsync(0)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(300)
    expect(fetchMock).toHaveBeenCalledTimes(2)
    // Attempt 1's ceiling is 600ms (base * 2^1).
    await vi.advanceTimersByTimeAsync(600)
    expect(fetchMock).toHaveBeenCalledTimes(3)

    await expect(promise).resolves.toBe(response)
  })

  it('gives up after exhausting retries and throws the last error', async () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.999)
    const err = new TypeError('Network request failed')
    const fetchMock = vi.fn().mockRejectedValue(err)
    vi.stubGlobal('fetch', fetchMock)

    const promise = fetchWithNetworkRetry('https://api.example/trpc')
    const assertion = expect(promise).rejects.toBe(err)

    await vi.advanceTimersByTimeAsync(0)
    await vi.advanceTimersByTimeAsync(300)
    await vi.advanceTimersByTimeAsync(600)

    await assertion
    // One initial attempt plus one retry per configured attempt — never a fourth.
    expect(fetchMock).toHaveBeenCalledTimes(3)
  })

  it('never waits longer than the capped ceiling, however many attempts are configured', () => {
    // Guards against an unbounded wait if NETWORK_RETRY_ATTEMPTS ever grows past what the
    // current 300/900ms flow exercises — attempt 3+ is where base*2^attempt would otherwise
    // exceed the 2s cap.
    vi.spyOn(Math, 'random').mockReturnValue(0.999)
    for (const attempt of [0, 1, 2, 3, 4, 5]) {
      expect(jitteredBackoffMs(attempt)).toBeLessThanOrEqual(2_000)
    }
    // And it does grow, up to that point — attempt 1's ceiling is double attempt 0's.
    expect(jitteredBackoffMs(1)).toBeCloseTo(jitteredBackoffMs(0) * 2, 0)
  })

  it('draws a delay somewhere inside the window rather than always the ceiling', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.5)
    // Attempt 0's ceiling is 300ms; half of that is the midpoint, not the edge.
    expect(jitteredBackoffMs(0)).toBeCloseTo(150, 0)
  })

  it('never retries a resolved response, even an error status', async () => {
    // A 500 is a real application-level result, not a failure to reach the server at all —
    // retrying it here would risk a duplicate write on whatever mutation sent it.
    const errorResponse = new Response('server error', { status: 500 })
    const fetchMock = vi.fn().mockResolvedValue(errorResponse)
    vi.stubGlobal('fetch', fetchMock)

    const response = await fetchWithNetworkRetry('https://api.example/trpc')

    expect(response.status).toBe(500)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('never retries a POST (mutation) even when fetch itself rejects', async () => {
    // React Native's fetch throws the identical generic error whether the connection failed
    // before anything was sent, or dropped after the body was fully delivered and only the
    // response was lost — the second case means the server may have already applied the
    // write, so retrying a mutation here risks a duplicate (e.g. a second transfer row).
    const err = new TypeError('Network request failed')
    const fetchMock = vi.fn().mockRejectedValue(err)
    vi.stubGlobal('fetch', fetchMock)

    await expect(fetchWithNetworkRetry('https://api.example/trpc', { method: 'POST' })).rejects.toBe(err)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('still retries an explicit GET the same as the default (no method) case', async () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.999)
    const response = new Response('ok')
    const fetchMock = vi.fn().mockRejectedValueOnce(new TypeError('Network request failed')).mockResolvedValueOnce(response)
    vi.stubGlobal('fetch', fetchMock)

    const promise = fetchWithNetworkRetry('https://api.example/trpc', { method: 'GET' })
    await vi.advanceTimersByTimeAsync(0)
    await vi.advanceTimersByTimeAsync(300)

    await expect(promise).resolves.toBe(response)
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('treats a stalled connection as a failure once the per-attempt timeout elapses, and retries it', async () => {
    // A connection that's accepted but never answered never rejects on its own — the mock
    // models that by only settling when its own signal is aborted, same as real fetch does.
    vi.spyOn(Math, 'random').mockReturnValue(0.999)
    const response = new Response('ok')
    let calls = 0
    const fetchMock = vi.fn().mockImplementation((_input: unknown, opts: RequestInit) => {
      calls++
      if (calls === 1) {
        return new Promise((_resolve, reject) => {
          opts.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')))
        })
      }
      return Promise.resolve(response)
    })
    vi.stubGlobal('fetch', fetchMock)

    const promise = fetchWithNetworkRetry('https://api.example/trpc')

    // Nothing happens until the per-attempt timeout (20s) fires and aborts the stalled attempt.
    await vi.advanceTimersByTimeAsync(20_000)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    // Then the usual jittered backoff before the retry, same as any other rejection.
    await vi.advanceTimersByTimeAsync(300)
    expect(fetchMock).toHaveBeenCalledTimes(2)

    await expect(promise).resolves.toBe(response)
  })

  it('never retries when the caller cancels the request itself, even for a GET', async () => {
    // httpBatchLink passes its own AbortSignal for query cancellation (unmount, a superseded
    // refetch) — that's a deliberate discard, not a connectivity failure, and must not look
    // like one just because it also makes fetch() reject.
    const callerController = new AbortController()
    const abortError = new DOMException('Aborted', 'AbortError')
    const fetchMock = vi.fn().mockImplementation(() => {
      callerController.abort()
      return Promise.reject(abortError)
    })
    vi.stubGlobal('fetch', fetchMock)

    await expect(fetchWithNetworkRetry('https://api.example/trpc', { signal: callerController.signal })).rejects.toBe(
      abortError,
    )
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('never issues a live request when the caller signal is already aborted before the call even starts', async () => {
    // The scenario fetchWithTimeout's own tests cover directly: a query cancelled between being
    // queued and httpBatchLink actually dispatching it. Asserted again here through the public
    // fetchWithNetworkRetry entry point, since it's the one this whole retry contract is about.
    const callerController = new AbortController()
    callerController.abort()
    const fetchMock = vi.fn().mockImplementation((_input: unknown, opts: RequestInit) => {
      return new Promise((_resolve, reject) => {
        if (opts.signal?.aborted) reject(new DOMException('Aborted', 'AbortError'))
      })
    })
    vi.stubGlobal('fetch', fetchMock)

    await expect(
      fetchWithNetworkRetry('https://api.example/trpc', { signal: callerController.signal }),
    ).rejects.toThrow('Aborted')
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})
