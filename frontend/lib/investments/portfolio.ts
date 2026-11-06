import { fillCalendarDays, priceableSymbol, type AccountHistory, type AccountPoint } from './accountHistory'
import type { InvestmentHistoryState } from '@/hooks/useInvestmentHistory'
import type { DailyClose, Holding, InvestmentActivity, Split } from '@/types/domain'

/**
 * One row per security across several accounts: the same fund held in a brokerage and an IRA reads
 * as one position on the all-accounts view, the way the user thinks of owning it.
 *
 * Quantities, values and cost basis add. Cost basis goes null if any account didn't report one —
 * a partial basis would print a gain the user never made. The price date keeps the older of the
 * two, so holdingsPricedAsOf never claims more freshness than the whole position has.
 */
export function mergeHoldings(lists: Holding[][]): Holding[] {
  const bySecurity = new Map<string, Holding>()
  for (const list of lists) {
    for (const holding of list) {
      const seen = bySecurity.get(holding.securityId)
      if (!seen) {
        bySecurity.set(holding.securityId, holding)
        continue
      }
      bySecurity.set(holding.securityId, {
        ...seen,
        quantity: seen.quantity + holding.quantity,
        institutionValue:
          seen.institutionValue == null && holding.institutionValue == null
            ? null
            : (seen.institutionValue ?? 0) + (holding.institutionValue ?? 0),
        costBasis: seen.costBasis == null || holding.costBasis == null ? null : seen.costBasis + holding.costBasis,
        priceAsOf:
          seen.priceAsOf == null || holding.priceAsOf == null
            ? null
            : seen.priceAsOf < holding.priceAsOf
              ? seen.priceAsOf
              : holding.priceAsOf,
      })
    }
  }
  return [...bySecurity.values()]
}

/**
 * Several accounts' value lines as one: each account's last known value carried forward onto every
 * calendar day any of them has, then summed. Carrying forward matters because accounts at different
 * institutions don't share trading-day calendars, and a day one of them skipped must not dip the sum.
 */
export function combineHistoryPoints(series: AccountPoint[][]): AccountPoint[] {
  const filled = series.map((points) => fillCalendarDays(points))
  const dates = [...new Set(filled.flatMap((points) => points.map((p) => p.date)))].sort()
  const cursors = filled.map(() => 0)
  const last: Array<AccountPoint | null> = filled.map(() => null)
  return dates.map((date) => {
    let value = 0
    let netDeposits = 0
    filled.forEach((points, i) => {
      while (cursors[i] < points.length && points[cursors[i]].date <= date) last[i] = points[cursors[i]++]
      value += last[i]?.value ?? 0
      netDeposits += last[i]?.netDeposits ?? 0
    })
    return { date, value: Math.round(value * 100) / 100, netDeposits }
  })
}

/** Splits with each one kept once, by symbol and ex-date. */
export function uniqueSplits(splits: Split[]): Split[] {
  const seen = new Set<string>()
  return splits.filter((split) => {
    const key = `${split.symbol}:${split.exDate}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

/** The all-accounts view's history state, folded from each account's. */
export function combineHistoryStates(states: InvestmentHistoryState[]): InvestmentHistoryState | undefined {
  if (states.length === 0) return undefined
  if (states.length === 1) return states[0]
  const histories = states.map((s) => s.history).filter((h): h is AccountHistory => h != null)
  const inputs = states.map((s) => s.inputs).filter((i) => i != null)
  return {
    // Waits for every account, so the combined line is never drawn short an account and then jumps.
    history:
      histories.length === states.length
        ? {
            points: combineHistoryPoints(histories.map((h) => h.points)),
            flat: histories.reduce(
              (sum, h) => ({ count: sum.count + h.flat.count, value: sum.value + h.flat.value }),
              { count: 0, value: 0 },
            ),
            incomplete: histories.some((h) => h.incomplete),
          }
        : null,
    inputs:
      inputs.length === 0
        ? null
        : {
            closes: Object.assign({}, ...inputs.map((i) => i.closes)),
            // Every account carries the same market-wide split list; joined as-is, each split
            // would appear once per account and be applied that many times.
            splits: uniqueSplits(inputs.flatMap((i) => i.splits)),
            activity: inputs.flatMap((i) => i.activity),
            securities: inputs.flatMap((i) => i.securities),
          },
    earliest: states.map((s) => s.earliest).sort()[0],
    priceEarliest: states.map((s) => s.priceEarliest).sort()[0],
    today: states[0].today,
    isLoading: states.some((s) => s.isLoading),
    isRateLimited: states.some((s) => s.isRateLimited),
    tradesUnavailable: states.some((s) => s.tradesUnavailable),
  }
}

/** Shares on a past day, carried onto today's basis: times each split's new-per-old ratio since. */
function splitFactorSince(splits: Split[], symbol: string, date: string, today: string): number {
  const seen = new Set<string>()
  let factor = 1
  for (const split of splits) {
    const key = `${split.symbol}:${split.exDate}`
    // Each split once: the list can repeat one per account it was gathered for.
    if (split.symbol !== symbol || split.exDate <= date || split.exDate > today || seen.has(key) || split.oldRate <= 0) continue
    seen.add(key)
    factor *= split.newRate / split.oldRate
  }
  return factor
}

function isTrade(row: InvestmentActivity): boolean {
  const subtype = row.subtype.toLowerCase()
  return subtype === 'buy' || subtype === 'sell'
}

/**
 * A position's gain over the chart's window, the way a brokerage would count it: today's value,
 * less what the position was worth when the window opened, less the money put into it (buys) or
 * taken out (sells) since. A position opened inside the window started at nothing, so its gain
 * comes down to its value against what was paid for it — the institution's cost basis, leaving out
 * what shares already sold made, as a brokerage's YTD does. One held from before the window is
 * measured from its value then, and trades since never read as gains.
 *
 * `activity` is this one account's: the shares held when the window opened are today's shares with
 * every trade since undone, so another account's trades in the same security would undo the wrong
 * position. Trade amounts follow Plaid's sign: a buy is money out of the account, positive.
 *
 * With no activity at all the trades can't be undone, and a position bought inside the window would
 * be priced as if held from its start; the institution's cost basis gives its total gain instead.
 * Null when there's neither, or no daily price to value the window's start at.
 */
export function holdingRangeChange(input: {
  holding: Holding
  activity: InvestmentActivity[]
  closes: Record<string, DailyClose[]>
  splits: Split[]
  start: string
  today: string
}): { gain: number; pct: number | null } | null {
  const { holding, activity, closes, splits, start, today } = input
  const price = holding.institutionPrice
  if (price == null) return null
  const valueNow = holding.institutionValue ?? holding.quantity * price

  if (activity.length === 0) {
    if (holding.costBasis == null || holding.costBasis <= 0) return null
    const gain = valueNow - holding.costBasis
    return { gain: Math.round(gain * 100) / 100, pct: gain / holding.costBasis }
  }

  const symbol = priceableSymbol({ ticker: holding.ticker, type: holding.type, isOption: holding.optionContract != null })
  const trades = activity.filter((row) => row.securityId === holding.securityId && isTrade(row) && row.date > start)

  // Today's shares with every trade since the window opened undone, all on today's share basis.
  let sharesAtStart = holding.quantity
  let netCashIn = 0
  let bought = 0
  for (const trade of trades) {
    const shares = Math.abs(trade.quantity) * (symbol ? splitFactorSince(splits, symbol, trade.date, today) : 1)
    const isBuy = trade.subtype.toLowerCase() === 'buy'
    sharesAtStart += isBuy ? -shares : shares
    netCashIn += trade.amount
    if (isBuy) bought += Math.abs(trade.amount)
  }
  // A sliver left over is rounding in the institution's share counts, not a position.
  if (sharesAtStart < 1e-6) sharesAtStart = 0

  // Opened inside the window: the shares held now against what was paid for them, as a brokerage
  // reports it. Counting the trades instead would add in what shares already sold made, and count
  // money sold out and bought back in once per round trip.
  if (sharesAtStart === 0 && holding.costBasis != null && holding.costBasis > 0) {
    const gain = valueNow - holding.costBasis
    return { gain: Math.round(gain * 100) / 100, pct: gain / holding.costBasis }
  }

  let valueAtStart = 0
  if (sharesAtStart > 0) {
    if (!symbol) return null
    let from: DailyClose | null = null
    for (const close of closes[symbol] ?? []) {
      if (close.date <= start && (from == null || close.date > from.date)) from = close
    }
    if (from == null) return null
    // An unadjusted close on that day's basis, carried onto today's like the shares are.
    valueAtStart = sharesAtStart * (from.close / splitFactorSince(splits, symbol, from.date, today))
  }

  const gain = valueNow - valueAtStart - netCashIn
  const base = valueAtStart + bought
  return { gain: Math.round(gain * 100) / 100, pct: base > 0 ? gain / base : null }
}
