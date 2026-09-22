import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_FETCH_TIMEOUT_MS, fetchWithTimeout } from './fetchTimeout.js'

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

    await expect(fetchWithTimeout()('https://example.com')).resolves.toBe(response)
  })

  it('aborts the underlying fetch once the timeout elapses', async () => {
    const fetchMock = vi.fn().mockImplementation((_input: unknown, opts: RequestInit) => {
      return new Promise((_resolve, reject) => {
        opts.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')))
      })
    })
    vi.stubGlobal('fetch', fetchMock)

    const promise = fetchWithTimeout(1_000)('https://example.com')
    const assertion = expect(promise).rejects.toThrow('Aborted')

    await vi.advanceTimersByTimeAsync(1_000)
    await assertion
  })

  it('immediately aborts a call whose signal is already aborted, rather than issuing a live request', async () => {
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

    await expect(fetchWithTimeout()('https://example.com', { signal: alreadyAborted.signal })).rejects.toThrow(
      'Aborted',
    )
  })

  it('defaults to a 10s timeout', () => {
    expect(DEFAULT_FETCH_TIMEOUT_MS).toBe(10_000)
  })
})
