import { formatShares } from '@/lib/accounts/holdings'
import type { DailyClose, InvestmentActivity, Split } from '@/types/domain'

function round2(value: number): number {
  return Math.round(value * 100) / 100
}

export interface SecurityPoint {
  date: string
  /** The close, split-adjusted to today's share basis, so a split never draws as a crash. */
  price: number
}

export interface Trade {
  date: string
  kind: 'buy' | 'sell'
  quantity: number
}

export interface SecurityHistory {
  points: SecurityPoint[]
  /** Buys and sells, oldest first, for markers on the line. Quantity is always positive. */
  trades: Trade[]
}

function tradeKind(row: InvestmentActivity): 'buy' | 'sell' | null {
  const subtype = row.subtype.toLowerCase()
  return subtype === 'buy' || subtype === 'sell' ? subtype : null
}

/**
 * One security's price line from `startDate` through today, with the position's trades.
 *
 * Its dates are the security's own closes, not the account's: a stock's history reaches as far back
 * as Alpaca has prices, while an account can only be rebuilt as far as Plaid's activity goes.
 * Split-adjusted, the convention every stock chart follows, so the stock's performance reads
 * continuously across a split; today's point is the latest trade when one is known. Null when the
 * security has no daily prices — the page then shows no chart rather than a flat line pretending to
 * be history.
 */
export function buildSecurityHistory(input: {
  closes: DailyClose[]
  /** This security's splits. */
  splits: Split[]
  /** This security's activity rows. */
  activity: InvestmentActivity[]
  startDate: string
  /** The latest trade price for today's point, when known. */
  latestPrice: number | null
  today: string
}): SecurityHistory | null {
  const { closes, splits, activity, startDate, latestPrice, today } = input
  if (closes.length === 0) return null

  const applicableSplits = splits.filter((s) => s.exDate <= today)
  const adjusted = (close: DailyClose) =>
    round2(applicableSplits.reduce((p, s) => (s.exDate > close.date ? (p * s.oldRate) / s.newRate : p), close.close))

  const points = closes.filter((c) => c.date >= startDate && c.date < today).map((c) => ({ date: c.date, price: adjusted(c) }))
  const last = closes.filter((c) => c.date <= today).at(-1) ?? closes[0]
  points.push({ date: today, price: latestPrice != null ? round2(latestPrice) : adjusted(last) })

  const trades = activity
    .flatMap((r): Trade[] => {
      const kind = tradeKind(r)
      return kind ? [{ date: r.date, kind, quantity: Math.abs(r.quantity) }] : []
    })
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))

  return { points, trades }
}

export interface TradeMarker {
  /** Index into the window's points. */
  index: number
  kind: 'buy' | 'sell'
  /** Shares traded that day in that direction, summed. */
  quantity: number
  /** The tooltip: "BUY 5 shares". */
  label: string
}

/**
 * One marker per day and direction for the trades inside the window: same-day fills summed, since
 * at a day's resolution they're one dot, and a buy and a sell on the same day kept apart, since they
 * mean opposite things. `dates` is the window's point dates, so an index lines up with the chart.
 */
export function tradeMarkers(trades: Trade[], dates: string[]): TradeMarker[] {
  const indexByDate = new Map(dates.map((d, i) => [d, i]))
  const byKey = new Map<string, TradeMarker>()
  for (const trade of trades) {
    const index = indexByDate.get(trade.date)
    if (index == null) continue
    const key = `${index}:${trade.kind}`
    const marker = byKey.get(key) ?? { index, kind: trade.kind, quantity: 0, label: '' }
    marker.quantity = Math.round((marker.quantity + trade.quantity) * 1e6) / 1e6
    byKey.set(key, marker)
  }
  return [...byKey.values()]
    .sort((a, b) => a.index - b.index || (a.kind === 'buy' ? -1 : 1))
    .map((m) => ({ ...m, label: `${m.kind.toUpperCase()} ${formatShares(m.quantity)} ${m.quantity === 1 ? 'share' : 'shares'}` }))
}

export interface TradeRow {
  id: string
  kind: 'buy' | 'sell'
  date: string
  /** Shares traded, always positive; `kind` carries the direction. */
  quantity: number
  /** Per-share price — the average fill when an order filled at several prices. */
  price: number
}

/** The position's buys and sells for its trades table, newest first. */
export function tradeTable(activity: InvestmentActivity[]): TradeRow[] {
  return activity
    .flatMap((r) => {
      const kind = tradeKind(r)
      return kind ? [{ id: r.investmentTransactionId, kind, date: r.date, quantity: Math.abs(r.quantity), price: r.price }] : []
    })
    .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0))
}
