import { describe, expect, it } from 'vitest'
import { AlpacaRateLimitError, createAlpacaClient } from './client.js'

/** A fetch stand-in that replays canned responses in order and records every URL it was asked for. */
function fakeFetch(responses: Array<{ status: number; body?: unknown; headers?: Record<string, string> }>) {
  const urls: string[] = []
  const headers: Array<Record<string, string>> = []
  const impl = async (url: string, init?: { headers?: Record<string, string> }) => {
    urls.push(url)
    headers.push(init?.headers ?? {})
    const next = responses.shift()
    if (!next) throw new Error(`unexpected request: ${url}`)
    return new Response(next.body === undefined ? null : JSON.stringify(next.body), {
      status: next.status,
      headers: next.headers,
    })
  }
  return { impl: impl as typeof fetch, urls, headers }
}

describe('getDailyCloses', () => {
  it('returns raw closes per symbol keyed by trading date, authenticated with the key pair', async () => {
    const fetch = fakeFetch([
      {
        status: 200,
        body: {
          bars: {
            AAPL: [
              { t: '2025-01-02T05:00:00Z', c: 243.85, o: 1, h: 1, l: 1, v: 1 },
              { t: '2025-01-03T05:00:00Z', c: 243.36, o: 1, h: 1, l: 1, v: 1 },
            ],
            VTI: [{ t: '2025-01-02T05:00:00Z', c: 289.12, o: 1, h: 1, l: 1, v: 1 }],
          },
          next_page_token: null,
        },
      },
    ])
    const client = createAlpacaClient('key-id', 'key-secret', fetch.impl)

    const closes = await client.getDailyCloses(['AAPL', 'VTI'], '2025-01-01', '2025-01-31')

    expect(closes).toEqual({
      AAPL: [
        { date: '2025-01-02', close: 243.85 },
        { date: '2025-01-03', close: 243.36 },
      ],
      VTI: [{ date: '2025-01-02', close: 289.12 }],
    })
    const url = new URL(fetch.urls[0])
    expect(url.pathname).toBe('/v2/stocks/bars')
    expect(url.searchParams.get('symbols')).toBe('AAPL,VTI')
    expect(url.searchParams.get('timeframe')).toBe('1Day')
    // Raw, never adjusted: an adjusted close is rewritten after every split, which would make a
    // never-expiring client cache silently wrong.
    expect(url.searchParams.get('adjustment')).toBe('raw')
    expect(fetch.headers[0]).toMatchObject({ 'APCA-API-KEY-ID': 'key-id', 'APCA-API-SECRET-KEY': 'key-secret' })
  })

  it('follows next_page_token and merges a symbol split across pages', async () => {
    const fetch = fakeFetch([
      {
        status: 200,
        body: { bars: { AAPL: [{ t: '2025-01-02T05:00:00Z', c: 1 }] }, next_page_token: 'page-2' },
      },
      {
        status: 200,
        body: { bars: { AAPL: [{ t: '2025-01-03T05:00:00Z', c: 2 }] }, next_page_token: null },
      },
    ])
    const client = createAlpacaClient('k', 's', fetch.impl)

    const closes = await client.getDailyCloses(['AAPL'], '2025-01-01', '2025-01-31')

    expect(closes.AAPL).toEqual([
      { date: '2025-01-02', close: 1 },
      { date: '2025-01-03', close: 2 },
    ])
    expect(new URL(fetch.urls[1]).searchParams.get('page_token')).toBe('page-2')
  })

  it('includes requested symbols that returned no bars as empty series', async () => {
    const fetch = fakeFetch([{ status: 200, body: { bars: {}, next_page_token: null } }])
    const client = createAlpacaClient('k', 's', fetch.impl)

    const closes = await client.getDailyCloses(['ZZZZ'], '2025-01-01', '2025-01-31')

    // Empty, not absent: the client caches "Alpaca has nothing for this month" as a fact, so a
    // ticker Alpaca doesn't carry is asked for once rather than on every sync.
    expect(closes).toEqual({ ZZZZ: [] })
  })

  it('throws AlpacaRateLimitError carrying seconds until the window resets on a 429', async () => {
    const nowSeconds = Math.floor(Date.now() / 1000)
    const fetch = fakeFetch([{ status: 429, headers: { 'X-RateLimit-Reset': String(nowSeconds + 42) } }])
    const client = createAlpacaClient('k', 's', fetch.impl)

    const error = await client.getDailyCloses(['AAPL'], '2025-01-01', '2025-01-31').catch((e) => e)

    expect(error).toBeInstanceOf(AlpacaRateLimitError)
    expect(error.retryAfterSeconds).toBeGreaterThanOrEqual(41)
    expect(error.retryAfterSeconds).toBeLessThanOrEqual(42)
  })

  it('falls back to a full minute when a 429 carries no reset header', async () => {
    const fetch = fakeFetch([{ status: 429 }])
    const client = createAlpacaClient('k', 's', fetch.impl)

    const error = await client.getDailyCloses(['AAPL'], '2025-01-01', '2025-01-31').catch((e) => e)

    expect(error).toBeInstanceOf(AlpacaRateLimitError)
    expect(error.retryAfterSeconds).toBe(60)
  })

  it('throws a plain error on any other failure status', async () => {
    const fetch = fakeFetch([{ status: 403, body: { message: 'forbidden' } }])
    const client = createAlpacaClient('k', 's', fetch.impl)

    const error = await client.getDailyCloses(['AAPL'], '2025-01-01', '2025-01-31').catch((e) => e)

    expect(error).not.toBeInstanceOf(AlpacaRateLimitError)
    expect(error.message).toMatch(/403/)
  })
})

describe('getSplits', () => {
  it('returns forward and reverse splits as old/new share ratios by ex-date', async () => {
    const fetch = fakeFetch([
      {
        status: 200,
        body: {
          corporate_actions: {
            forward_splits: [{ symbol: 'NVDA', ex_date: '2024-06-10', old_rate: 1, new_rate: 10 }],
            reverse_splits: [{ symbol: 'GE', ex_date: '2021-08-02', old_rate: 8, new_rate: 1 }],
          },
          next_page_token: null,
        },
      },
    ])
    const client = createAlpacaClient('k', 's', fetch.impl)

    const splits = await client.getSplits(['NVDA', 'GE'], '2021-01-01', '2025-01-01')

    expect(splits).toEqual([
      { symbol: 'NVDA', exDate: '2024-06-10', oldRate: 1, newRate: 10 },
      { symbol: 'GE', exDate: '2021-08-02', oldRate: 8, newRate: 1 },
    ])
    const url = new URL(fetch.urls[0])
    expect(url.pathname).toBe('/v1/corporate-actions')
    expect(url.searchParams.get('types')).toBe('forward_split,reverse_split')
  })
})

describe('getLatestPrices', () => {
  it('returns each symbol’s latest trade price and time from one snapshots call', async () => {
    const fetch = fakeFetch([
      {
        status: 200,
        body: {
          AAA: { latestTrade: { t: '2025-01-06T20:59:58.1Z', p: 101.5 }, dailyBar: { c: 101.4 } },
          BBB: { latestTrade: { t: '2025-01-06T18:02:00Z', p: 20.25 } },
        },
      },
    ])
    const client = createAlpacaClient('k', 's', fetch.impl)

    const prices = await client.getLatestPrices(['AAA', 'BBB'])

    expect(prices).toEqual({
      AAA: { price: 101.5, at: '2025-01-06T20:59:58.1Z' },
      BBB: { price: 20.25, at: '2025-01-06T18:02:00Z' },
    })
    const url = new URL(fetch.urls[0])
    expect(url.pathname).toBe('/v2/stocks/snapshots')
    expect(url.searchParams.get('symbols')).toBe('AAA,BBB')
    expect(url.searchParams.get('feed')).toBe('iex')
  })

  it('leaves out a symbol with no trade, rather than inventing a price', async () => {
    const fetch = fakeFetch([{ status: 200, body: { AAA: { latestTrade: null }, BBB: null } }])
    const client = createAlpacaClient('k', 's', fetch.impl)

    expect(await client.getLatestPrices(['AAA', 'BBB', 'CCC'])).toEqual({})
  })

  it('throws AlpacaRateLimitError on a 429, like the bars call', async () => {
    const fetch = fakeFetch([{ status: 429 }])
    const client = createAlpacaClient('k', 's', fetch.impl)

    await expect(client.getLatestPrices(['AAA'])).rejects.toBeInstanceOf(AlpacaRateLimitError)
  })
})
