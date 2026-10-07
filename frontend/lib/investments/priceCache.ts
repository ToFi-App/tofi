import type { DailyClose } from '@/types/domain'

/**
 * Days after a month ends before its closes are treated as final. Bars can be corrected for a
 * day or two after the fact; once cached, a month is never asked for again.
 */
export const SETTLE_DAYS = 3

/** YYYY-MM for a YYYY-MM-DD date. */
export function monthOf(date: string): string {
  return date.slice(0, 7)
}

function firstOfNextMonth(month: string): Date {
  const [year, m] = month.split('-').map(Number)
  return new Date(Date.UTC(year, m, 1))
}

/** Every calendar month the range touches, oldest first, inclusive of both ends. */
export function monthsBetween(startDate: string, endDate: string): string[] {
  const months: string[] = []
  let month = monthOf(startDate)
  const last = monthOf(endDate)
  while (month <= last) {
    months.push(month)
    month = firstOfNextMonth(month).toISOString().slice(0, 7)
  }
  return months
}

/** Whether a month is over and past its correction window, so its closes can be cached forever. */
export function isSettled(month: string, today: string): boolean {
  const settlesOn = firstOfNextMonth(month)
  settlesOn.setUTCDate(settlesOn.getUTCDate() + SETTLE_DAYS)
  return today >= settlesOn.toISOString().slice(0, 10)
}

export interface PriceFetchPlan {
  symbols: string[]
  startDate: string
  endDate: string
  splitsSince: string
}

/**
 * The one request this sync needs: every symbol with a month it doesn't hold, from the first of
 * the earliest such month through today. The open month is never held, so a warm cache still
 * asks for it — one small call a day.
 *
 * Splits are always asked for over the whole chart range: they adjust cached closes too (see
 * buildPortfolioHistory), and they're small.
 */
export function planPriceFetch(input: {
  symbols: string[]
  startDate: string
  today: string
  isCached: (symbol: string, month: string) => boolean
}): PriceFetchPlan | null {
  const { symbols, startDate, today, isCached } = input
  const months = monthsBetween(startDate, today)
  const missing = (symbol: string) => months.filter((m) => !isSettled(m, today) || !isCached(symbol, m))

  const needed = symbols.filter((s) => missing(s).length > 0)
  if (needed.length === 0) return null
  const earliest = needed.map((s) => missing(s)[0]).sort()[0]

  return { symbols: needed, startDate: `${earliest}-01`, endDate: today, splitsSince: startDate }
}

/**
 * The month entries a successful response lets the cache keep: each settled month the request
 * covered in full, per symbol — empty ones included, so a ticker Alpaca doesn't carry is learned
 * once rather than re-asked forever.
 */
export function settledMonthsToWrite(input: {
  closes: Record<string, DailyClose[]>
  startDate: string
  endDate: string
  today: string
}): Array<{ symbol: string; month: string; closes: DailyClose[] }> {
  const { closes, startDate, endDate, today } = input
  const fullyCovered = monthsBetween(startDate, endDate).filter(
    (m) => startDate <= `${m}-01` && isSettled(m, today) && firstOfNextMonth(m).toISOString().slice(0, 10) <= endDate,
  )

  return Object.entries(closes).flatMap(([symbol, series]) =>
    fullyCovered.map((month) => ({ symbol, month, closes: series.filter((c) => monthOf(c.date) === month) })),
  )
}

/**
 * Each symbol's closes across the chart's months: a held month from the cache, any other from
 * the fresh response. Held months win so an overlapping response never doubles a day. With no
 * response yet, unheld months are simply absent — the chart holds those tickers flat.
 */
export function assembleCloses(input: {
  symbols: string[]
  months: string[]
  readMonth: (symbol: string, month: string) => DailyClose[] | null
  fresh: Record<string, DailyClose[]> | undefined
}): Record<string, DailyClose[]> {
  const { symbols, months, readMonth, fresh } = input
  return Object.fromEntries(
    symbols.map((symbol) => {
      const series = months.flatMap(
        (month) => readMonth(symbol, month) ?? (fresh?.[symbol] ?? []).filter((c) => monthOf(c.date) === month),
      )
      return [symbol, series]
    }),
  )
}

/** Rate-limit retries before giving up for the session. Each waits out a full quota window. */
const RATE_LIMIT_RETRIES = 5

function retryAfterSeconds(error: unknown): number | null {
  const data = (error as { data?: { code?: string; retryAfterSeconds?: number } } | null)?.data
  return data?.code === 'TOO_MANY_REQUESTS' && typeof data.retryAfterSeconds === 'number' ? data.retryAfterSeconds : null
}

/** Whether a failed price fetch is worth repeating — patiently for a rate limit, once otherwise. */
export function shouldRetryPriceFetch(failureCount: number, error: unknown): boolean {
  return retryAfterSeconds(error) != null ? failureCount < RATE_LIMIT_RETRIES : failureCount < 1
}

/** How long to wait before the retry: the quota's own reset for a rate limit, a beat otherwise. */
export function priceRetryDelayMs(_failureCount: number, error: unknown): number {
  return (retryAfterSeconds(error) ?? 2) * 1000
}

/** Whether the fetch is currently waiting out a rate limit, for the chart's status line. */
export function isRateLimited(error: unknown): boolean {
  return retryAfterSeconds(error) != null
}
