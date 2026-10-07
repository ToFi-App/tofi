import { describe, expect, it } from 'vitest'
import { isSettled, monthsBetween, planPriceFetch, settledMonthsToWrite } from './priceCache'

describe('monthsBetween', () => {
  it('lists every calendar month the range touches, inclusive', () => {
    expect(monthsBetween('2024-11-15', '2025-02-03')).toEqual(['2024-11', '2024-12', '2025-01', '2025-02'])
  })
})

describe('isSettled', () => {
  it('treats a month as final only a few days after it ends, once late corrections are in', () => {
    expect(isSettled('2025-01', '2025-01-31')).toBe(false)
    expect(isSettled('2025-01', '2025-02-02')).toBe(false)
    expect(isSettled('2025-01', '2025-02-04')).toBe(true)
  })
})

describe('planPriceFetch', () => {
  const cached = (entries: string[]) => (symbol: string, month: string) => entries.includes(`${symbol}:${month}`)

  it('on a cold cache, asks for every symbol from the first of the starting month', () => {
    // From the 1st, not the range's own start: a month fetched partly can't be cached, and would
    // then be re-requested on every sync.
    expect(
      planPriceFetch({ symbols: ['AAA', 'BBB'], startDate: '2024-12-10', today: '2025-02-10', isCached: cached([]) }),
    ).toEqual({ symbols: ['AAA', 'BBB'], startDate: '2024-12-01', endDate: '2025-02-10', splitsSince: '2024-12-10' })
  })

  it('with settled months cached, asks only for the open month', () => {
    expect(
      planPriceFetch({
        symbols: ['AAA'],
        startDate: '2024-12-10',
        today: '2025-02-10',
        isCached: cached(['AAA:2024-12', 'AAA:2025-01']),
      }),
    ).toEqual({ symbols: ['AAA'], startDate: '2025-02-01', endDate: '2025-02-10', splitsSince: '2024-12-10' })
  })

  it('reaches back to the earliest gap any symbol has, and asks only for symbols with one', () => {
    // BBB was added to the portfolio after AAA's history was cached.
    const plan = planPriceFetch({
      symbols: ['AAA', 'BBB'],
      startDate: '2024-12-10',
      today: '2025-02-10',
      isCached: cached(['AAA:2024-12', 'AAA:2025-01', 'BBB:2025-01']),
    })
    expect(plan).toEqual({ symbols: ['AAA', 'BBB'], startDate: '2024-12-01', endDate: '2025-02-10', splitsSince: '2024-12-10' })
  })

  it('needs no request when there are no symbols to price', () => {
    expect(planPriceFetch({ symbols: [], startDate: '2024-12-10', today: '2025-02-10', isCached: cached([]) })).toBeNull()
  })
})

describe('settledMonthsToWrite', () => {
  it('writes each settled month per symbol, empty months included, and never the open month', () => {
    const writes = settledMonthsToWrite({
      closes: {
        AAA: [
          { date: '2025-01-02', close: 1 },
          { date: '2025-02-03', close: 2 },
        ],
        ZZZ: [],
      },
      startDate: '2025-01-01',
      endDate: '2025-02-10',
      today: '2025-02-10',
    })

    expect(writes).toEqual([
      { symbol: 'AAA', month: '2025-01', closes: [{ date: '2025-01-02', close: 1 }] },
      // Alpaca has nothing for ZZZ: cached as empty so it's never asked for again.
      { symbol: 'ZZZ', month: '2025-01', closes: [] },
    ])
  })

  it('does not write a month the request only partly covered', () => {
    // A request starting mid-month holds only part of December; caching it would freeze the gap.
    const writes = settledMonthsToWrite({
      closes: { AAA: [{ date: '2024-12-20', close: 1 }] },
      startDate: '2024-12-10',
      endDate: '2025-02-10',
      today: '2025-02-10',
    })

    expect(writes.map((w) => w.month)).toEqual(['2025-01'])
  })
})

describe('assembleCloses', () => {
  it('takes held months from the cache and the rest from the fresh response, in date order', async () => {
    const { assembleCloses } = await import('./priceCache')
    const cache: Record<string, { date: string; close: number }[]> = {
      'AAA:2025-01': [{ date: '2025-01-02', close: 1 }],
    }

    const closes = assembleCloses({
      symbols: ['AAA'],
      months: ['2025-01', '2025-02'],
      readMonth: (symbol, month) => cache[`${symbol}:${month}`] ?? null,
      // The fresh response overlaps the held month; the held copy must not be doubled.
      fresh: { AAA: [{ date: '2025-01-02', close: 1 }, { date: '2025-02-03', close: 2 }] },
    })

    expect(closes).toEqual({
      AAA: [
        { date: '2025-01-02', close: 1 },
        { date: '2025-02-03', close: 2 },
      ],
    })
  })

  it('serves whatever is held when the fetch has not succeeded', async () => {
    const { assembleCloses } = await import('./priceCache')

    const closes = assembleCloses({
      symbols: ['AAA', 'BBB'],
      months: ['2025-01', '2025-02'],
      readMonth: (symbol, month) => (symbol === 'AAA' && month === '2025-01' ? [{ date: '2025-01-02', close: 1 }] : null),
      fresh: undefined,
    })

    expect(closes).toEqual({ AAA: [{ date: '2025-01-02', close: 1 }], BBB: [] })
  })
})

describe('price fetch retries', () => {
  const rateLimited = (seconds: number) => ({ data: { code: 'TOO_MANY_REQUESTS', retryAfterSeconds: seconds } })

  it('waits out a rate limit for as long as the server says, a few times', async () => {
    const { priceRetryDelayMs, shouldRetryPriceFetch } = await import('./priceCache')
    expect(shouldRetryPriceFetch(0, rateLimited(12))).toBe(true)
    expect(shouldRetryPriceFetch(4, rateLimited(12))).toBe(true)
    expect(shouldRetryPriceFetch(5, rateLimited(12))).toBe(false)
    expect(priceRetryDelayMs(0, rateLimited(12))).toBe(12_000)
  })

  it('retries any other failure once, quickly', async () => {
    const { priceRetryDelayMs, shouldRetryPriceFetch } = await import('./priceCache')
    const other = { data: { code: 'INTERNAL_SERVER_ERROR' } }
    expect(shouldRetryPriceFetch(0, other)).toBe(true)
    expect(shouldRetryPriceFetch(1, other)).toBe(false)
    expect(priceRetryDelayMs(0, other)).toBe(2_000)
  })
})
