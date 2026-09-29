import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_FETCH_TIMEOUT_MS, fetchWithTimeout } from './fetchTimeout'

describe('fetchWithTimeout', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('returns the response when fetch resolves before the timeout', async () => {
    const response = new Response('ok')
    const fetchMock = vi.fn().mockResolvedValue(response)
    vi.stubGlobal('fetch', fetchMock)

    await expect(fetchWithTimeout()('https://api.example')).resolves.toBe(response)
  })

  it('aborts the underlying fetch once the timeout elapses', async () => {
    const fetchMock = vi.fn().mockImplementation((_input: unknown, opts: RequestInit) => {
      return new Promise((_resolve, reject) => {
        opts.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')))
      })
    })
    vi.stubGlobal('fetch', fetchMock)

    const promise = fetchWithTimeout(1_000)('https://api.example')
    const assertion = expect(promise).rejects.toThrow('Aborted')

    await vi.advanceTimersByTimeAsync(1_000)
    await assertion
  })

  it('immediately aborts a call whose signal is already aborted, rather than issuing a live request', async () => {
    // The bug this guards against: a plain `addEventListener('abort', ...)` relay never fires
    // for a signal already in the aborted state — the event only fires on the transition, and
    // that transition already happened before this call started. Without the explicit
    // `callerSignal?.aborted` check, the underlying fetch would proceed as if never cancelled.
    const fetchMock = vi.fn().mockImplementation((_input: unknown, opts: RequestInit) => {
      return new Promise((_resolve, reject) => {
        if (opts.signal?.aborted) {
          reject(new DOMException('Aborted', 'AbortError'))
          return
        }
        opts.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')))
      })
    })
    vi.stubGlobal('fetch', fetchMock)

    const alreadyAborted = new AbortController()
    alreadyAborted.abort()

    await expect(fetchWithTimeout()('https://api.example', { signal: alreadyAborted.signal })).rejects.toThrow(
      'Aborted',
    )
  })

  it('aborts when the caller cancels mid-flight, not just at call time', async () => {
    const fetchMock = vi.fn().mockImplementation((_input: unknown, opts: RequestInit) => {
      return new Promise((_resolve, reject) => {
        opts.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')))
      })
    })
    vi.stubGlobal('fetch', fetchMock)

    const callerController = new AbortController()
    const promise = fetchWithTimeout()('https://api.example', { signal: callerController.signal })
    const assertion = expect(promise).rejects.toThrow('Aborted')

    callerController.abort()
    await assertion
  })

  it('defaults to a 20s timeout', () => {
    expect(DEFAULT_FETCH_TIMEOUT_MS).toBe(20_000)
  })
})
