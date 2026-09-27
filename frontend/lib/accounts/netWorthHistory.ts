import type { FeedItem } from '@/lib/transactions/resolveFeed'
import { isInternalMovement, isTransfer } from '@/lib/transactions/totals'
import { AUTO_MATCH_WINDOW_DAYS } from '@/lib/transfers/autoMatch'
import { daysBetween } from '@/lib/transfers/registry'
import { round2 } from './netWorth'
import { CASH_ON_HAND_KEY } from './composition'

/**
 * Net worth history is *back-cast* from today's balances rather than read from stored
 * snapshots — balances are fetched live from Plaid and never persisted (architecture.md),
 * so there is no historical series to query.
 *
 * The walk relies on one invariant: for any Plaid transaction, `amount` is positive when
 * money leaves the account. On a depository account a $100 debit drops the balance by 100;
 * on a credit account a $100 purchase raises the amount owed by 100. Net worth subtracts
 * liabilities, so both move net worth by `-amount` — which also makes transfers cancel out
 * (the $50 leaving checking and the $50 paid off the card sum to zero).
 *
 * So: netWorth(end of month M-1) = netWorth(end of month M) - change(M), where
 * change(M) = -sum(amount) over M. Starting from today's net worth, that walks backwards.
 *
 * Manual transactions count on exactly the same terms. `computeCashOnHand` treats them as a
 * cash pot inside totalAssets, so the anchor this walks back from already contains them, and
 * a manual expense unwinds to a real past cash balance rather than to an offset from today.
 * The pot's zero point (before the first manual entry) is what makes that exact.
 *
 * Investment-source rows join the walk on exactly the same terms, with no exclusion needed: the
 * only ones ingested are cash crossing the account boundary, which really does move money. A
 * contribution's two legs (the checking outflow and the investment-side arrival) cancel to zero,
 * which is the correct answer and an improvement on reading the checking leg alone. Trades never
 * reach the feed at all — they are filtered out in the backend repository — so the buy that would
 * otherwise unwind as a $10,000 drop that never happened cannot appear here.
 *
 * The walk only works when every row it unwinds has its other half in the feed too. Some don't,
 * and countsTowardNetWorth drops those; see there.
 *
 * One limit remains, inherent to reconstructing from a ledger: market movement is invisible. No
 * feed row exists for a holding gaining or losing value, so an investment account's growth stays
 * baked into today's anchor and is carried flat across every past month.
 *
 * One thing to be aware of rather than a limit: cash withdrawn from a linked account and then
 * logged as a manual expense moves the line twice — once as the ATM debit Plaid saw, once as
 * the manual entry. That is correct under this model (the withdrawal moved money from bank to
 * wallet; the manual entry then spent it) only if the withdrawal itself was logged as cash
 * income too. The app's spend totals already double-count that pair, so this stays consistent
 * with them either way.
 */
export interface MonthPoint {
  year: number
  month: number // 1-12
  netWorth: number
  /** Net worth movement during this month — netWorth minus the previous month's. */
  change: number
}

function toIndex(year: number, month: number): number {
  return year * 12 + (month - 1)
}

function fromIndex(index: number): { year: number; month: number } {
  return { year: Math.floor(index / 12), month: (index % 12) + 1 }
}

/** Integer cents, so float amounts are safe as map keys. */
function centsKey(item: FeedItem): number {
  return Math.round(Math.abs(item.amount) * 100)
}

/**
 * Rows whose account's balance is part of today's anchor. Manual transactions have no accountId by
 * design and always qualify. Account-backed ones (plaid and investment alike) are dropped when
 * their account is no longer linked: that balance left the net worth total when the institution
 * was removed, so its history would be unwinding a phantom. Pending rows are dropped because the
 * anchor is Plaid's settled `current` balance, which doesn't include them yet — unwinding one
 * would move a month for money that hasn't landed.
 */
function isInAnchor(item: FeedItem, linkedAccountIds: Set<string>): boolean {
  if (item.pending) return false
  return item.source === 'manual' || (item.accountId != null && linkedAccountIds.has(item.accountId))
}

/**
 * Whether a row moved net worth — deliberately NOT countsTowardTotals. The two answer different
 * questions and disagree on transfers in opposite directions:
 *  - a paired transfer is excluded from spend totals, but here BOTH legs must stay, because their
 *    cancelling out is exactly what keeps the line flat;
 *  - a brokerage-cash sweep into holdings, or a core-fund redemption out of them, has its other
 *    half in an investment trade the feed never carries. Kept, its lone leg unwinds as a gain or
 *    loss that never happened — the dip that used to appear in every month with a sweep.
 *
 * So only unpaired internal movement is dropped (isInternalMovement minus the transfer case, plus
 * the swept outflow), and even that is kept when an equal, opposite row on another anchored
 * account within autoMatch's window shows the money crossed between two of the user's accounts
 * rather than into holdings — then both halves are in the walk and cancel, and dropping one would
 * leave the other as a phantom. The check runs both ways because applySweepExclusion's
 * hasCrossAccountCounterpart only looks at outflows, and an unpaired inbound transfer on the cash
 * account is just as common.
 */
function netWorthPredicate(feed: FeedItem[], linkedAccountIds: Set<string>): (item: FeedItem) => boolean {
  const anchored = feed.filter((item) => isInAnchor(item, linkedAccountIds))
  const byCents = new Map<number, FeedItem[]>()
  for (const item of anchored) {
    const bucket = byCents.get(centsKey(item))
    if (bucket) bucket.push(item)
    else byCents.set(centsKey(item), [item])
  }
  const hasCrossAccountCounterpart = (item: FeedItem): boolean =>
    (byCents.get(centsKey(item)) ?? []).some(
      (candidate) =>
        candidate.accountId !== item.accountId &&
        Math.sign(candidate.amount) === -Math.sign(item.amount) &&
        daysBetween(candidate.postedDate, item.postedDate) <= AUTO_MATCH_WINDOW_DAYS,
    )

  const counted = new Set(
    anchored.filter((item) => {
      if (isTransfer(item)) return true
      if (!item.isSweptOutflow && !isInternalMovement(item)) return true
      return hasCrossAccountCounterpart(item)
    }),
  )
  return (item) => counted.has(item)
}

/** Which balance a row moves: its linked account, or the cash-on-hand pot for a manual entry. */
function balanceKey(item: FeedItem): string {
  return item.source === 'manual' ? CASH_ON_HAND_KEY : item.accountId!
}

/**
 * Monthly net flow, keyed by absolute month index and then by balance (balanceKey), over every
 * transaction that moved net worth.
 */
function flowByMonth(feed: FeedItem[], linkedAccountIds: Set<string>): Map<number, Map<string, number>> {
  const flow = new Map<number, Map<string, number>>()
  const countsTowardNetWorth = netWorthPredicate(feed, linkedAccountIds)
  for (const item of feed) {
    if (!countsTowardNetWorth(item)) continue
    const year = Number(item.date.slice(0, 4))
    const month = Number(item.date.slice(5, 7))
    if (!Number.isFinite(year) || !Number.isFinite(month) || month < 1 || month > 12) continue
    // Gross `amount`, not `netAmount`: a reimbursement's income transaction is its own feed
    // item, so netting it out here would count the same dollars twice.
    const index = toIndex(year, month)
    const byKey = flow.get(index) ?? new Map<string, number>()
    byKey.set(balanceKey(item), (byKey.get(balanceKey(item)) ?? 0) + item.amount)
    flow.set(index, byKey)
  }
  return flow
}

/**
 * The one backwards walk both histories share, so the per-account bars and the net worth line
 * can never disagree about which months exist or what moved in them.
 *
 * Every balance is signed the way it counts toward net worth (a card's $400 owed is -400), which
 * makes the walk the same for every account type: a row's `amount` moves its balance by -amount,
 * so undoing a month adds the month's flow back.
 */
function walkBalances(
  anchors: Map<string, number>,
  feed: FeedItem[],
  linkedAccountIds: Set<string>,
  year: number | undefined,
  today: Date,
  /** Which anchor a balanceKey's flow lands on. Identity by default; net worth folds every key into one. */
  anchorFor: (key: string) => string = (key) => key,
  /** Per-account sign a real balance must have; see computeAccountHistory's `expectedSign`. */
  expectedSign?: Map<string, 1 | -1>,
): AccountMonthPoint[] {
  const nowIndex = toIndex(today.getFullYear(), today.getMonth() + 1)
  const flow = flowByMonth(feed, linkedAccountIds)

  // Each signed account's first month of activity — where "before it existed" begins.
  const openIndex = new Map<string, number>()
  if (expectedSign) {
    for (const [index, byKey] of flow) {
      for (const key of byKey.keys()) {
        if (!expectedSign.has(key)) continue
        const seen = openIndex.get(key)
        if (seen === undefined || index < seen) openIndex.set(key, index)
      }
    }
  }

  let earliestIndex = nowIndex
  for (const index of flow.keys()) {
    if (index < earliestIndex) earliestIndex = index
  }

  const requestedFirst = year != null ? toIndex(year, 1) : earliestIndex
  const requestedLast = year != null ? toIndex(year, 12) : nowIndex
  if (requestedFirst > nowIndex || requestedLast < earliestIndex) return []

  const snapshot = () => {
    const balances = new Map<string, number>()
    for (const [key, value] of running) balances.set(key, round2(value))
    return balances
  }

  // Walk back from today one month at a time, keeping only what lands in `year`.
  const months: AccountMonthPoint[] = []
  const running = new Map(anchors)
  for (let index = nowIndex; index >= earliestIndex; index--) {
    const monthFlow = flow.get(index) ?? new Map<string, number>()
    const point = index >= requestedFirst && index <= requestedLast ? { ...fromIndex(index), balances: snapshot(), flow: monthFlow } : null
    for (const [key, amount] of monthFlow) running.set(anchorFor(key), (running.get(anchorFor(key)) ?? 0) + amount)

    // Having just undone an account's first month, `running` holds its balance before any
    // activity. If that balance has a sign the account cannot have, it did not exist yet: zero.
    // Nothing earlier moves it, so it stays zero for the rest of the walk.
    for (const [key, open] of openIndex) {
      if (index !== open) continue
      const value = running.get(key) ?? 0
      if (value * expectedSign!.get(key)! < 0) running.set(key, 0)
    }

    if (point) months.push({ ...point, startBalances: snapshot() })
  }

  return months.reverse()
}

/**
 * Net worth at the end of each month, ascending — every month of `year`, or the entire
 * history (oldest synced transaction through today) when `year` is omitted. Months earlier
 * than the oldest synced transaction are omitted rather than flat-lined — with no ledger to
 * unwind, their value is unknown, not unchanged.
 */
export function computeNetWorthHistory(
  currentNetWorth: number,
  feed: FeedItem[],
  linkedAccountIds: Set<string>,
  year?: number,
  today: Date = new Date(),
): MonthPoint[] {
  // Net worth is the one balance every row moves, so every key folds into a single anchor.
  const TOTAL = 'total'
  return walkBalances(new Map([[TOTAL, currentNetWorth]]), feed, linkedAccountIds, year, today, () => TOTAL).map((m) => {
    let flow = 0
    for (const amount of m.flow.values()) flow += amount
    return { year: m.year, month: m.month, netWorth: m.balances.get(TOTAL)!, change: round2(-flow) }
  })
}

export interface AccountMonthPoint {
  year: number
  month: number // 1-12
  /**
   * End-of-month balance per account id, plus CASH_ON_HAND_KEY for the manual pot — signed as it
   * counts toward net worth, so liabilities are negative. Sums to that month's net worth.
   */
  balances: Map<string, number>
  /** Sum of `amount` per balance during the month. */
  flow: Map<string, number>
  /**
   * Balances as the month OPENED (the previous month's close). Usually `balances` plus `flow`, but
   * not for an account that appeared this month — it opens at zero (see `expectedSign`).
   */
  startBalances: Map<string, number>
}

/**
 * The same history as computeNetWorthHistory, split by account. `anchors` holds today's signed
 * balance for every account whose history should be drawn; the months covered are identical.
 *
 * Investment accounts move only when cash crosses their boundary — market movement has no feed
 * row (see the note at the top of this file), so their value is otherwise carried flat.
 */
export function computeAccountHistory(
  anchors: Map<string, number>,
  feed: FeedItem[],
  linkedAccountIds: Set<string>,
  year?: number,
  today: Date = new Date(),
  options: {
    /**
     * The sign a real balance must have, per account: 1 for cash accounts, -1 for debt (signed as
     * net worth counts it). An account whose balance before its first transaction comes out with
     * the other sign did not exist yet, and reads as zero before that month — a cash management
     * account opened in June, walked back past June, otherwise shows a balance below zero.
     *
     * A balance with the right sign is kept: that is what an account older than the history
     * looks like. Leave investment accounts (their leftover is real market growth) and the
     * manual cash pot (negative is meaningful there) out.
     */
    expectedSign?: Map<string, 1 | -1>
  } = {},
): AccountMonthPoint[] {
  return walkBalances(anchors, feed, linkedAccountIds, year, today, undefined, options.expectedSign)
}

/**
 * The net worth line as the sum of an account history, so the line and the bars are one
 * calculation — including an account appearing from zero, which a single-total walk cannot see.
 */
export function netWorthFromAccounts(months: AccountMonthPoint[]): MonthPoint[] {
  const sum = (balances: Map<string, number>) => {
    let total = 0
    for (const value of balances.values()) total += value
    return round2(total)
  }
  return months.map((m) => {
    const netWorth = sum(m.balances)
    return { year: m.year, month: m.month, netWorth, change: round2(netWorth - sum(m.startBalances)) }
  })
}

/** Years the history can cover: from the oldest synced transaction through the current year. */
export function netWorthYearRange(
  feed: FeedItem[],
  linkedAccountIds: Set<string>,
  today: Date = new Date(),
): { first: number; last: number } {
  const last = today.getFullYear()
  let first = last
  for (const index of flowByMonth(feed, linkedAccountIds).keys()) {
    const { year } = fromIndex(index)
    if (year < first) first = year
  }
  return { first, last }
}
