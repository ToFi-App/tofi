import type { ActivitySecurity, DailyClose, Holding, InvestmentActivity, Split } from '@/types/domain'

/**
 * Holding types Alpaca carries daily equity bars for. Mutual funds, bonds, crypto, options and
 * cash have none on the free plan, so they never reach the request.
 */
const PRICEABLE_TYPES = new Set(['equity', 'etf'])

/** Same shape the backend validates; anything else would fail Alpaca's whole batch. */
const ALPACA_SYMBOL = /^[A-Z][A-Z0-9.]{0,9}$/

/** How close to Alpaca's ex-date an institution's own split row may land and still count as it. */
const SPLIT_MATCH_DAYS = 7

/** Shares below this after unwinding are float noise, not missing history. */
const SHARE_EPSILON = 1e-6

interface SecurityInfo {
  ticker: string | null
  type: string | null
  isOption: boolean
}

/** The symbol to ask Alpaca for, or null when this security is drawn flat. */
export function priceableSymbol(security: SecurityInfo): string | null {
  if (security.isOption || !security.type || !PRICEABLE_TYPES.has(security.type)) return null
  if (!security.ticker || !ALPACA_SYMBOL.test(security.ticker)) return null
  return security.ticker
}

/** Every Alpaca symbol the account's history needs: today's holdings and anything traded since. */
export function historySymbols(holdings: Holding[], securities: ActivitySecurity[]): string[] {
  const symbols = new Set<string>()
  for (const h of holdings) {
    const symbol = priceableSymbol({ ticker: h.ticker, type: h.type, isOption: h.optionContract != null })
    if (symbol) symbols.add(symbol)
  }
  for (const s of securities) {
    const symbol = priceableSymbol(s)
    if (symbol) symbols.add(symbol)
  }
  return [...symbols].sort()
}

function valueToday(holding: Holding): number {
  return holding.institutionValue ?? holding.quantity * (holding.institutionPrice ?? 0)
}

function round2(value: number): number {
  return Math.round(value * 100) / 100
}


function daysApart(a: string, b: string): number {
  return Math.abs(Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / 86_400_000
}

/**
 * Units a row moved, signed into the account. Institutions disagree on the sign of a sell's
 * quantity, so buys and sells are signed by subtype; anything else keeps the sign it came with.
 */
function signedQuantity(row: InvestmentActivity): number {
  const subtype = row.subtype.toLowerCase()
  if (subtype === 'sell') return -Math.abs(row.quantity)
  if (subtype === 'buy') return Math.abs(row.quantity)
  return row.quantity
}

function isTrade(row: InvestmentActivity): boolean {
  const subtype = row.subtype.toLowerCase()
  return subtype === 'buy' || subtype === 'sell'
}

/** Units arriving or leaving outside a trade: a split paid out as shares, a transfer in or out. */
function isShareDelivery(row: InvestmentActivity): boolean {
  return row.securityId != null && row.quantity !== 0 && !isTrade(row)
}

/**
 * The cash a row moved. A share delivery moved none, though some institutions type one as a cash
 * deposit and give it the shares' value as its amount; undoing that amount would take cash out of
 * the past that was never there.
 */
function cashMoved(row: InvestmentActivity): number {
  return isShareDelivery(row) ? 0 : row.amount
}

export interface AccountPoint {
  date: string
  /** Account value at the end of this day. */
  value: number
  /** Money deposited less withdrawn through the end of this day. Only differences are meaningful. */
  netDeposits: number
}

export interface AccountHistory {
  points: AccountPoint[]
  /** Holdings held today with no daily prices, drawn flat at today's price. Cash excluded. */
  flat: { count: number; value: number }
  /**
   * Unwinding the activity drove some position below zero shares: the institution's history is
   * missing rows (older than its window, or never reported), so earlier points undercount it.
   */
  incomplete: boolean
}

interface Position {
  shares: number
  /** Unadjusted daily closes; empty when unpriced. */
  closes: DailyClose[]
  /** Used when there are no closes: today's price if held, else the last price it traded at. */
  fallbackPrice: number
  /** Unit changes to undo walking back, newest first. A split is a ratio; a trade is a delta. */
  events: Array<{ date: string; delta?: number; ratio?: number }>
}

/**
 * The account's value on each past day, rebuilt from today's holdings by undoing every later row
 * of its activity: a buy is undone as fewer shares and more cash, a sell as the reverse, a deposit
 * as less cash. Each day's shares are then priced at that day's unadjusted close.
 *
 * Share counts are the ones actually held on each day, so unadjusted closes are the right prices —
 * provided every split is in the activity. Institutions don't all report one, so a split Alpaca
 * lists with no matching row nearby is undone here as a ratio instead.
 *
 * With no activity at all (the institution doesn't serve it), this is today's holdings priced back
 * in time, with splits still undone from Alpaca's list.
 *
 * Cash is today's balance less today's non-cash holdings, so the line ends on the headline.
 * Trades on a cash-typed holding are skipped (moving cash into the cash line changes nothing), but
 * its dividends and interest count as money arriving.
 */
export function buildAccountHistory(input: {
  holdings: Holding[]
  activity: InvestmentActivity[]
  securities: ActivitySecurity[]
  anchorValue: number
  closes: Record<string, DailyClose[]>
  splits: Split[]
  startDate: string
  today: string
}): AccountHistory {
  const { holdings, activity, securities, anchorValue, closes, splits, startDate, today } = input

  const info = new Map<string, SecurityInfo>()
  for (const s of securities) info.set(s.securityId, s)
  for (const h of holdings) info.set(h.securityId, { ticker: h.ticker, type: h.type, isOption: h.optionContract != null })
  const isCash = (securityId: string) => info.get(securityId)?.type === 'cash'

  const positions = new Map<string, Position>()
  const position = (securityId: string): Position => {
    let p = positions.get(securityId)
    if (!p) {
      const symbol = priceableSymbol(info.get(securityId) ?? { ticker: null, type: null, isOption: false })
      p = { shares: 0, closes: symbol ? (closes[symbol] ?? []) : [], fallbackPrice: 0, events: [] }
      positions.set(securityId, p)
    }
    return p
  }

  let cash = anchorValue
  const flat = { count: 0, value: 0 }
  for (const h of holdings) {
    if (h.type === 'cash') continue
    const p = position(h.securityId)
    p.shares = h.quantity
    p.fallbackPrice = h.institutionPrice ?? (h.quantity ? valueToday(h) / h.quantity : 0)
    cash -= valueToday(h)
    if (p.closes.length === 0) {
      flat.count += 1
      flat.value += valueToday(h)
    }
  }

  // Newest first, the order they're undone in. A trade on a cash-typed holding only moves money
  // between cash and the core position — both already in `cash` — so it is dropped. Anything else
  // on it is kept: a dividend or interest paid on the core position is real money arriving, and
  // dropping it left every earlier day too high by the total it ever paid.
  const rows = activity
    .filter((r) => !(r.securityId && isCash(r.securityId) && isTrade(r)))
    .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0))

  for (const row of rows) {
    // Cash is tracked as cash, never as a position of shares.
    if (!row.securityId || isCash(row.securityId)) continue
    const p = position(row.securityId)
    p.events.push({ date: row.date, delta: signedQuantity(row) })
    if (p.fallbackPrice === 0 && row.price > 0) p.fallbackPrice = row.price
  }

  // Splits the institution never reported. Same-day ordering: a split takes effect at the open, so
  // walking back, that day's trades are undone first and the split after them.
  for (const [securityId, p] of positions) {
    const symbol = priceableSymbol(info.get(securityId) ?? { ticker: null, type: null, isOption: false })
    if (!symbol) continue
    for (const split of splits) {
      if (split.symbol !== symbol || split.exDate <= startDate || split.exDate > today) continue
      // Reported either as a split, or as shares delivered around the ex-date (some institutions
      // pay a split out as a share deposit). Undoing it again would divide the shares twice.
      const reported = rows.some(
        (r) =>
          r.securityId === securityId &&
          (/split/i.test(r.subtype) || isShareDelivery(r)) &&
          daysApart(r.date, split.exDate) <= SPLIT_MATCH_DAYS,
      )
      if (!reported) p.events.push({ date: split.exDate, ratio: split.oldRate / split.newRate })
    }
    p.events.sort((a, b) => (a.date !== b.date ? (a.date < b.date ? 1 : -1) : (a.ratio ? 1 : 0) - (b.ratio ? 1 : 0)))
  }

  // Axis: the start, every trading day, and every activity day (an unpriced account still steps).
  const dates = new Set<string>([startDate])
  for (const p of positions.values()) for (const c of p.closes) if (c.date >= startDate && c.date < today) dates.add(c.date)
  for (const r of rows) if (r.date >= startDate && r.date < today) dates.add(r.date)
  const axis = [...dates].sort()

  const depositsThrough = (date: string) =>
    rows.reduce((sum, r) => (r.isCashTransfer && r.date <= date ? sum - r.amount : sum), 0)

  let incomplete = false
  const pointsNewestFirst: AccountPoint[] = [
    { date: today, value: round2(anchorValue), netDeposits: round2(depositsThrough(today)) },
  ]

  // Walk back from today. State is end-of-day; undoing everything dated after `date` gives the
  // end of `date`.
  const state = new Map([...positions].map(([id, p]) => [id, { shares: p.shares, next: 0 }]))
  let rowCursor = 0
  for (let i = axis.length - 1; i >= 0; i--) {
    const date = axis[i]
    while (rowCursor < rows.length && rows[rowCursor].date > date) cash += cashMoved(rows[rowCursor++])

    let value = cash
    for (const [id, p] of positions) {
      const s = state.get(id)!
      while (s.next < p.events.length && p.events[s.next].date > date) {
        const event = p.events[s.next++]
        s.shares = event.ratio != null ? s.shares * event.ratio : s.shares - event.delta!
      }
      if (s.shares < -SHARE_EPSILON) incomplete = true
      const shares = Math.max(s.shares, 0)
      if (shares === 0) continue
      value += shares * priceOn(p, date)
    }
    pointsNewestFirst.push({ date, value: round2(value), netDeposits: round2(depositsThrough(date)) })
  }

  return { points: pointsNewestFirst.reverse(), flat: { count: flat.count, value: round2(flat.value) }, incomplete }
}

/** The last close on or before `date`; before the first close, the first. Fallback when unpriced. */
function priceOn(p: Position, date: string): number {
  if (p.closes.length === 0) return p.fallbackPrice
  let price = p.closes[0].close
  for (const c of p.closes) {
    if (c.date > date) break
    price = c.close
  }
  return price
}

/**
 * The market's part of the account's change from the first point on or after `rangeStart` to the
 * last: the value's change less the money deposited over the same stretch, so money put in never
 * reads as a gain.
 *
 * The percentage is total return over the range, the same formula as the sheet's headline
 * (totalReturn in lib/accounts/principal.ts): the gain over what the range had to work with — its
 * opening value plus net deposits. No timing weighting, deliberately, so a range covering the
 * account's whole history agrees with the headline. Null once withdrawals leave no base.
 */
export function rangeGain(points: AccountPoint[], rangeStart: string): { gain: number; pct: number | null } | null {
  const inRange = points.filter((p) => p.date >= rangeStart)
  if (inRange.length < 2) return null
  const first = inRange[0]
  const last = inRange[inRange.length - 1]
  const deposits = last.netDeposits - first.netDeposits
  const gain = round2(last.value - first.value - deposits)
  const base = first.value + deposits
  return { gain, pct: base > 0 ? gain / base : null }
}

/**
 * What the headline reads while the chart is in view, the way the net worth panel does: the
 * selected point (tapped or scrubbed), or the latest one when none is, and its gain since the window
 * opened. An out-of-range selection reads as none — the window can move under a stale index.
 */
export function windowReading(
  visible: AccountPoint[],
  selectedIndex: number | null,
): { value: number; gain: { gain: number; pct: number | null } | null } | null {
  if (visible.length === 0) return null
  const index = selectedIndex != null && selectedIndex < visible.length ? selectedIndex : visible.length - 1
  return { value: visible[index].value, gain: rangeGain(visible.slice(0, index + 1), visible[0].date) }
}

export interface CashFlowMarker {
  /** Index into the window's points. */
  index: number
  kind: 'deposit' | 'withdrawal'
  /** Money in or out that day, summed, always positive. */
  amount: number
}

/**
 * One marker per day and direction for money crossing the account inside the window — the rows the
 * backend flags as cash transfers, never trades. Same-day transfers are summed; a deposit and a
 * withdrawal on the same day stay apart. `dates` is the window's point dates.
 */
export function cashFlowMarkers(activity: InvestmentActivity[], dates: string[]): CashFlowMarker[] {
  const indexByDate = new Map(dates.map((d, i) => [d, i]))
  const byKey = new Map<string, CashFlowMarker>()
  for (const row of activity) {
    if (!row.isCashTransfer || row.amount === 0) continue
    const index = indexByDate.get(row.date)
    if (index == null) continue
    // Plaid's sign: negative is cash arriving.
    const kind = row.amount < 0 ? 'deposit' : 'withdrawal'
    const key = `${index}:${kind}`
    const marker = byKey.get(key) ?? { index, kind, amount: 0 }
    marker.amount = round2(marker.amount + Math.abs(row.amount))
    byKey.set(key, marker)
  }
  return [...byKey.values()].sort((a, b) => a.index - b.index || (a.kind === 'deposit' ? -1 : 1))
}

/**
 * One point per calendar day, each missing day (a weekend, a holiday) a copy of the day before it.
 *
 * The zoomable chart lays points out one per day and reads a scrubbing finger back the same way —
 * slot n is point n — so a series with only trading days drifts out from under the finger, further
 * the longer the window. A value really is unchanged over a weekend, so carrying it is exact, and a
 * finger resting on a Saturday reads Friday's close under Saturday's date. Ascending input.
 */
export function fillCalendarDays<T extends { date: string }>(points: T[]): T[] {
  const filled: T[] = []
  for (const point of points) {
    const previous = filled[filled.length - 1]
    if (previous) {
      let day = Date.parse(`${previous.date}T00:00:00Z`) + 86_400_000
      const target = Date.parse(`${point.date}T00:00:00Z`)
      for (; day < target; day += 86_400_000) {
        filled.push({ ...previous, date: new Date(day).toISOString().slice(0, 10) })
      }
    }
    filled.push(point)
  }
  return filled
}
