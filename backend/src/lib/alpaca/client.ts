const DATA_HOST = 'https://data.alpaca.markets'

/** Alpaca's page cap for bars. One page covers ~40 tickers x a year of daily bars. */
const BARS_PAGE_LIMIT = 10_000

/**
 * Bounds one request's paging. A portfolio-sized request drains in a page or two; this only
 * guards against an API that keeps handing back tokens.
 */
const MAX_PAGES = 20

/** When a 429 carries no reset header: Alpaca's window is one minute. */
const DEFAULT_RETRY_AFTER_SECONDS = 60

export interface DailyClose {
  /** Trading date, YYYY-MM-DD. */
  date: string
  /** Raw, unadjusted close. */
  close: number
}

export interface LatestPrice {
  price: number
  /** When that trade printed, ISO 8601. */
  at: string
}

export interface Split {
  symbol: string
  /** First trading day at the new share count. Prices before it are pre-split. */
  exDate: string
  /** Shares before the split, per `newRate` after: a 1-for-10 forward split is 1 -> 10. */
  oldRate: number
  newRate: number
}

/**
 * Alpaca's per-minute quota ran out. Typed so the caller can pass the wait on to the client
 * rather than retrying here: the quota is shared by every user of the app, so a serverless
 * function sleeping on it would only spend money to make the queue longer.
 */
export class AlpacaRateLimitError extends Error {
  constructor(readonly retryAfterSeconds: number) {
    super(`Alpaca rate limit reached; retry in ${retryAfterSeconds}s`)
    this.name = 'AlpacaRateLimitError'
  }
}

function retryAfterFrom(response: Response): number {
  const reset = Number(response.headers.get('X-RateLimit-Reset'))
  if (!Number.isFinite(reset) || reset <= 0) return DEFAULT_RETRY_AFTER_SECONDS
  return Math.max(1, reset - Math.floor(Date.now() / 1000))
}

/**
 * Market data from Alpaca, relayed and never stored server-side: historical prices are licensed
 * data, and the device cache is the only place they persist.
 */
export function createAlpacaClient(keyId: string, secret: string, fetchImpl: typeof fetch = fetch) {
  async function get<T>(path: string, params: Record<string, string>): Promise<T> {
    const url = `${DATA_HOST}${path}?${new URLSearchParams(params).toString()}`
    const response = await fetchImpl(url, {
      headers: { 'APCA-API-KEY-ID': keyId, 'APCA-API-SECRET-KEY': secret },
    })
    if (response.status === 429) throw new AlpacaRateLimitError(retryAfterFrom(response))
    if (!response.ok) throw new Error(`Alpaca ${path} failed with ${response.status}`)
    return (await response.json()) as T
  }

  /**
   * Bars for every symbol, drained across pages. Every requested symbol gets an entry, empty when
   * Alpaca returned nothing for it — the client caches "nothing this month" as a fact.
   */
  async function fetchBars(
    symbols: string[],
    range: { timeframe: string; start: string; end?: string },
  ): Promise<Record<string, Array<{ t: string; c: number }>>> {
    const bars: Record<string, Array<{ t: string; c: number }>> = Object.fromEntries(symbols.map((s) => [s, []]))
    let pageToken: string | null = null

    for (let page = 0; page < MAX_PAGES; page++) {
      const params: Record<string, string> = {
        symbols: symbols.join(','),
        timeframe: range.timeframe,
        start: range.start,
        // Raw on purpose: adjusted closes are rewritten after every split, and the client caches
        // closes forever. Splits are applied on read instead (see getSplits).
        adjustment: 'raw',
        // The free plan's feed. Closes can differ slightly from the consolidated close.
        feed: 'iex',
        limit: String(BARS_PAGE_LIMIT),
      }
      if (range.end) params.end = range.end
      if (pageToken) params.page_token = pageToken

      const body = await get<{ bars: Record<string, Array<{ t: string; c: number }>> | null; next_page_token: string | null }>(
        '/v2/stocks/bars',
        params,
      )
      for (const [symbol, series] of Object.entries(body.bars ?? {})) {
        ;(bars[symbol] ??= []).push(...series.map((b) => ({ t: b.t, c: b.c })))
      }

      pageToken = body.next_page_token
      if (!pageToken) break
    }

    return bars
  }

  return {
    async getDailyCloses(symbols: string[], startDate: string, endDate: string): Promise<Record<string, DailyClose[]>> {
      const bars = await fetchBars(symbols, { timeframe: '1Day', start: startDate, end: endDate })
      // Daily bars are stamped at midnight New York time, so the UTC date is the trading date.
      return Object.fromEntries(
        Object.entries(bars).map(([symbol, series]) => [symbol, series.map((b) => ({ date: b.t.slice(0, 10), close: b.c }))]),
      )
    },

    /**
     * Each symbol's latest trade, from one snapshots call. A symbol with no trade on the feed is
     * left out: the caller keeps the institution's price for it rather than a made-up one.
     */
    async getLatestPrices(symbols: string[]): Promise<Record<string, LatestPrice>> {
      const body = await get<Record<string, { latestTrade?: { t: string; p: number } | null } | null>>(
        '/v2/stocks/snapshots',
        { symbols: symbols.join(','), feed: 'iex' },
      )
      const prices: Record<string, LatestPrice> = {}
      for (const [symbol, snapshot] of Object.entries(body ?? {})) {
        const trade = snapshot?.latestTrade
        if (trade && Number.isFinite(trade.p) && trade.p > 0) prices[symbol] = { price: trade.p, at: trade.t }
      }
      return prices
    },

    async getSplits(symbols: string[], startDate: string, endDate: string): Promise<Split[]> {
      type RawSplit = { symbol: string; ex_date: string; old_rate: number; new_rate: number }
      const splits: Split[] = []
      let pageToken: string | null = null

      for (let page = 0; page < MAX_PAGES; page++) {
        const params: Record<string, string> = {
          symbols: symbols.join(','),
          types: 'forward_split,reverse_split',
          start: startDate,
          end: endDate,
        }
        if (pageToken) params.page_token = pageToken

        const body = await get<{
          corporate_actions: { forward_splits?: RawSplit[]; reverse_splits?: RawSplit[] }
          next_page_token: string | null
        }>('/v1/corporate-actions', params)
        const actions = body.corporate_actions ?? {}
        for (const s of [...(actions.forward_splits ?? []), ...(actions.reverse_splits ?? [])]) {
          splits.push({ symbol: s.symbol, exDate: s.ex_date, oldRate: s.old_rate, newRate: s.new_rate })
        }

        pageToken = body.next_page_token
        if (!pageToken) break
      }

      return splits
    },
  }
}

export type AlpacaClient = ReturnType<typeof createAlpacaClient>

/**
 * The app-wide client. One key serves every user, so its 200 calls/min are shared — the client's
 * month cache is what keeps that budget out of reach (see useInvestmentPriceHistory).
 */
export function alpacaClientFromEnv(): AlpacaClient {
  const keyId = process.env.ALPACA_KEY_ID
  const secret = process.env.ALPACA_SECRET_KEY
  if (!keyId || !secret) throw new Error('ALPACA_KEY_ID / ALPACA_SECRET_KEY are not set')
  return createAlpacaClient(keyId, secret)
}
