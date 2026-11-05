import type { Holding, InvestmentActivity } from '@/types/domain'

/** How far back a trade can be and still count as one the brokerage's holdings haven't caught up with. */
const RECENT_DAYS = 14
/** Share counts this close are equal: quantities are fractional, and float sums drift. */
const SAME = 1e-6

function round2(value: number): number {
  return Math.round(value * 100) / 100
}

function round6(value: number): number {
  return Math.round(value * 1e6) / 1e6
}

function daysBetween(from: string, to: string): number {
  return (Date.parse(`${to.slice(0, 10)}T00:00:00Z`) - Date.parse(`${from.slice(0, 10)}T00:00:00Z`)) / 86_400_000
}

interface Trade {
  date: string
  /** Shares into the account: positive for a buy, negative for a sale, whatever sign the institution sent. */
  shares: number
  /** What a buy cost; zero for a sale. */
  cost: number
  /** Cash into the account: a sale's proceeds, less a purchase's cost. */
  cash: number
}

function tradesBySecurity(activity: InvestmentActivity[]): Map<string, Trade[]> {
  const bySecurity = new Map<string, Trade[]>()
  for (const row of activity) {
    if (!row.securityId) continue
    const subtype = row.subtype.toLowerCase()
    if (subtype !== 'buy' && subtype !== 'sell') continue
    const trade: Trade =
      subtype === 'buy'
        ? { date: row.date, shares: Math.abs(row.quantity), cost: Math.abs(row.amount), cash: -Math.abs(row.amount) }
        : { date: row.date, shares: -Math.abs(row.quantity), cost: 0, cash: Math.abs(row.amount) }
    const list = bySecurity.get(row.securityId) ?? []
    list.push(trade)
    bySecurity.set(row.securityId, list)
  }
  return bySecurity
}

/**
 * Holdings with the trades their brokerage hasn't caught up with applied, so a position sold
 * yesterday is gone today rather than after the brokerage's next upload.
 *
 * The brokerage can't be asked how old its holdings are: through Plaid it stamps every holding with
 * the day it was asked, even when the shares and price are from before a sale. So the share count is
 * checked against the trades instead. If a security's trades add up to the holding's shares, the
 * holding is current. If they only add up once the newest few are left out, those are the trades the
 * holding is missing — they're applied, and a position they close is dropped. If no recent cut makes
 * the sums agree — a position held since before the two years of trades Plaid serves, say — the
 * holding is left as the brokerage sent it: the arithmetic has to explain the gap exactly, or nothing
 * is changed.
 *
 * Value scales with the new share count at the holding's price; a sale leaves the average cost as it
 * was, a purchase adds what it cost. Only recent trades (RECENT_DAYS) can count as missing.
 */
export function applyUnreflectedTrades(holdings: Holding[], activity: InvestmentActivity[], today: string): Holding[] {
  return reconcileAccount(holdings, activity, today).holdings
}

/**
 * applyUnreflectedTrades, plus the cash those trades moved: the brokerage's balance comes from the
 * same snapshot as its holdings, so a sale it hasn't caught up with is missing from its cash as well
 * as its positions. `cashDelta` is what to add to that balance — a sale's proceeds, less a
 * purchase's cost — alongside the holdings' own change in value.
 */
export function reconcileAccount(
  holdings: Holding[],
  activity: InvestmentActivity[],
  today: string,
): { holdings: Holding[]; cashDelta: number } {
  if (activity.length === 0) return { holdings, cashDelta: 0 }
  const bySecurity = tradesBySecurity(activity)
  if (bySecurity.size === 0) return { holdings, cashDelta: 0 }

  let changed = false
  let cashDelta = 0
  const result: Holding[] = []
  for (const holding of holdings) {
    const trades = bySecurity.get(holding.securityId)
    const missing = trades ? unreflected(trades, holding.quantity, today) : null
    if (!missing) {
      result.push(holding)
      continue
    }
    changed = true
    cashDelta += missing.reduce((sum, t) => sum + t.cash, 0)

    const added = missing.reduce((sum, t) => sum + t.shares, 0)
    const shares = holding.quantity + added
    if (shares <= SAME) continue

    const sold = missing.reduce((sum, t) => sum + Math.max(0, -t.shares), 0)
    const boughtCost = missing.reduce((sum, t) => sum + t.cost, 0)
    const price = holding.institutionPrice ?? (holding.quantity ? (holding.institutionValue ?? 0) / holding.quantity : 0)
    // A sale takes its shares out at the average cost, which it leaves as it was; a purchase adds
    // what it cost.
    const kept = holding.quantity > 0 ? Math.max(0, holding.quantity - sold) / holding.quantity : 0
    result.push({
      ...holding,
      quantity: round6(shares),
      institutionValue: holding.institutionValue == null ? null : round2(shares * price),
      costBasis: holding.costBasis == null ? null : round2(holding.costBasis * kept + boughtCost),
    })
  }
  return changed ? { holdings: result, cashDelta: round2(cashDelta) } : { holdings, cashDelta: 0 }
}

/**
 * The newest trades a holding of `held` shares is missing, or null when it's current or the sums
 * can't explain the difference. Peels trades off newest first, within RECENT_DAYS, until what's left
 * adds up to the holding.
 */
function unreflected(trades: Trade[], held: number, today: string): Trade[] | null {
  const total = trades.reduce((sum, t) => sum + t.shares, 0)
  if (Math.abs(total - held) < SAME) return null

  const newestFirst = [...trades].sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0))
  let remaining = total
  const peeled: Trade[] = []
  for (const trade of newestFirst) {
    if (daysBetween(trade.date, today) > RECENT_DAYS) break
    remaining -= trade.shares
    peeled.push(trade)
    if (Math.abs(remaining - held) < SAME) return peeled
  }
  return null
}
