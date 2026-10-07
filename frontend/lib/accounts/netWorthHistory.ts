import type { FeedItem } from '@/lib/transactions/resolveFeed'
import { isInternalMovement, isTransfer } from '@/lib/transactions/totals'
import { AUTO_MATCH_WINDOW_DAYS } from '@/lib/transfers/autoMatch'
import { daysBetween } from '@/lib/transfers/registry'
import { round2 } from './netWorth'
import { CASH_ON_HAND_KEY } from './composition'
import { MONTH_NAMES } from '@/lib/format/date'

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

export type Granularity = 'day' | 'week' | 'month'

const MS_PER_DAY = 86_400_000

/** Whole days since 1970-01-01 for a YYYY-MM-DD key, in UTC so DST never shifts a day. */
function dayNumber(date: string): number {
  return Math.floor(Date.parse(`${date.slice(0, 10)}T00:00:00Z`) / MS_PER_DAY)
}

function isoFromDayNumber(day: number): string {
  return new Date(day * MS_PER_DAY).toISOString().slice(0, 10)
}

/** Today's local calendar date as YYYY-MM-DD — "today" is the user's day, not UTC's. */
function localIso(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

/**
 * The bucket a date falls in, as an ascending integer: a day number, a Monday-based week number
 * (1970-01-01 was a Thursday, hence the +3), or the absolute month index.
 */
export function bucketOf(date: string, granularity: Granularity): number {
  if (granularity === 'month') return toIndex(Number(date.slice(0, 4)), Number(date.slice(5, 7)))
  const day = dayNumber(date)
  return granularity === 'day' ? day : Math.floor((day + 3) / 7)
}

/** The first calendar day of a bucket, as YYYY-MM-DD. */
function bucketStart(bucket: number, granularity: Granularity): string {
  if (granularity === 'month') {
    const { year, month } = fromIndex(bucket)
    return `${year}-${String(month).padStart(2, '0')}-01`
  }
  return isoFromDayNumber(granularity === 'day' ? bucket : bucket * 7 - 3)
}

/**
 * Net flow per bucket, then per balance (balanceKey), over every transaction that moved net worth.
 */
function flowByBucket(
  feed: FeedItem[],
  linkedAccountIds: Set<string>,
  granularity: Granularity,
): Map<number, Map<string, number>> {
  const flow = new Map<number, Map<string, number>>()
  const countsTowardNetWorth = netWorthPredicate(feed, linkedAccountIds)
  for (const item of feed) {
    if (!countsTowardNetWorth(item)) continue
    if (!/^\d{4}-\d{2}-\d{2}/.test(item.date)) continue
    const month = Number(item.date.slice(5, 7))
    if (month < 1 || month > 12) continue
    // Gross `amount`, not `netAmount`: a reimbursement's income transaction is its own feed
    // item, so netting it out here would count the same dollars twice.
    const bucket = bucketOf(item.date, granularity)
    const byKey = flow.get(bucket) ?? new Map<string, number>()
    byKey.set(balanceKey(item), (byKey.get(balanceKey(item)) ?? 0) + item.amount)
    flow.set(bucket, byKey)
  }
  return flow
}

interface BucketPoint {
  bucket: number
  balances: Map<string, number>
  flow: Map<string, number>
  startBalances: Map<string, number>
}

/**
 * The one backwards walk every history shares — monthly, weekly or daily — so the per-account
 * bars and the net worth line can never disagree about which buckets exist or what moved in them.
 *
 * Every balance is signed the way it counts toward net worth (a card's $400 owed is -400), which
 * makes the walk the same for every account type: a row's `amount` moves its balance by -amount,
 * so undoing a bucket adds its flow back.
 *
 * Walks from `nowBucket` back to the oldest bucket with data, keeping those inside
 * [firstBucket, lastBucket]. Buckets before the oldest data are never emitted — with no ledger to
 * unwind, their value is unknown, not unchanged.
 */
function walkBuckets(
  anchors: Map<string, number>,
  flow: Map<number, Map<string, number>>,
  range: { nowBucket: number; firstBucket: number | null; lastBucket: number },
  /** Which anchor a balanceKey's flow lands on. Identity by default; net worth folds every key into one. */
  anchorFor: (key: string) => string = (key) => key,
  /** Per-account sign a real balance must have; see computeAccountHistory's `expectedSign`. */
  expectedSign?: Map<string, 1 | -1>,
): BucketPoint[] {
  const { nowBucket, lastBucket } = range

  // Each signed account's first bucket of activity — where "before it existed" begins.
  const openBucket = new Map<string, number>()
  if (expectedSign) {
    for (const [bucket, byKey] of flow) {
      for (const key of byKey.keys()) {
        if (!expectedSign.has(key)) continue
        const seen = openBucket.get(key)
        if (seen === undefined || bucket < seen) openBucket.set(key, bucket)
      }
    }
  }

  let earliest = nowBucket
  for (const bucket of flow.keys()) {
    if (bucket < earliest) earliest = bucket
  }
  const firstBucket = Math.max(range.firstBucket ?? earliest, earliest)
  if (firstBucket > nowBucket || lastBucket < earliest) return []

  const running = new Map(anchors)
  const snapshot = () => {
    const balances = new Map<string, number>()
    for (const [key, value] of running) balances.set(key, round2(value))
    return balances
  }

  const points: BucketPoint[] = []
  for (let bucket = nowBucket; bucket >= earliest; bucket--) {
    const bucketFlow = flow.get(bucket) ?? new Map<string, number>()
    const point = bucket >= firstBucket && bucket <= lastBucket ? { bucket, balances: snapshot(), flow: bucketFlow } : null
    for (const [key, amount] of bucketFlow) running.set(anchorFor(key), (running.get(anchorFor(key)) ?? 0) + amount)

    // Having just undone an account's first bucket, `running` holds its balance before any
    // activity. If that balance has a sign the account cannot have, it did not exist yet: zero.
    // Nothing earlier moves it, so it stays zero for the rest of the walk.
    for (const [key, open] of openBucket) {
      if (bucket !== open) continue
      const value = running.get(key) ?? 0
      if (value * expectedSign!.get(key)! < 0) running.set(key, 0)
    }

    if (point) points.push({ ...point, startBalances: snapshot() })
    // Nothing before the requested range is emitted, and the clamp above only needs the walk
    // to reach each account's opening — past both, there is no reason to keep going.
    if (bucket <= firstBucket && [...openBucket.values()].every((open) => bucket <= open)) break
  }

  return points.reverse()
}

/** The monthly walk, as every monthly history reads it. */
function walkBalances(
  anchors: Map<string, number>,
  feed: FeedItem[],
  linkedAccountIds: Set<string>,
  year: number | undefined,
  today: Date,
  anchorFor?: (key: string) => string,
  expectedSign?: Map<string, 1 | -1>,
): AccountMonthPoint[] {
  const nowBucket = toIndex(today.getFullYear(), today.getMonth() + 1)
  const flow = flowByBucket(feed, linkedAccountIds, 'month')
  const range = {
    nowBucket,
    firstBucket: year != null ? toIndex(year, 1) : null,
    lastBucket: year != null ? toIndex(year, 12) : nowBucket,
  }
  return walkBuckets(anchors, flow, range, anchorFor, expectedSign).map(({ bucket, ...rest }) => ({
    ...fromIndex(bucket),
    ...rest,
  }))
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
  for (const index of flowByBucket(feed, linkedAccountIds, 'month').keys()) {
    const { year } = fromIndex(index)
    if (year < first) first = year
  }
  return { first, last }
}

export type TrendRange = '1W' | '1M' | '3M' | 'YTD' | '1Y' | '5Y' | 'ALL'

/** Past this many days a range draws weekly rather than daily — a stacked bar per day turns into
 *  thousands of shapes to redraw on every tap. */
const DAILY_LIMIT_DAYS = 100

export interface TrendPoint extends Omit<BucketPoint, 'bucket'> {
  /** Ascending bucket number; consecutive buckets are adjacent days, weeks or months. */
  bucket: number
  /** The bucket's first day, YYYY-MM-DD. */
  start: string
}

/**
 * Per-account history over a time range, at a resolution chosen for it: days for up to 3 months
 * (and a young year-to-date), weeks for a year, months for everything. Same walk, same rules as the
 * monthly history — only the bucket size changes.
 */
export function computeTrend(
  anchors: Map<string, number>,
  feed: FeedItem[],
  linkedAccountIds: Set<string>,
  range: TrendRange,
  today: Date = new Date(),
  options: { expectedSign?: Map<string, 1 | -1> } = {},
): { granularity: Granularity; points: TrendPoint[] } {
  const todayIso = localIso(today)
  const todayDay = dayNumber(todayIso)
  const yearStart = `${today.getFullYear()}-01-01`

  let granularity: Granularity
  let fromDay: number | null
  switch (range) {
    case '1W':
      granularity = 'day'
      fromDay = todayDay - 6
      break
    case '1M':
      granularity = 'day'
      fromDay = todayDay - 29
      break
    case '3M':
      granularity = 'day'
      fromDay = todayDay - 89
      break
    case 'YTD':
      fromDay = dayNumber(yearStart)
      granularity = todayDay - fromDay + 1 <= DAILY_LIMIT_DAYS ? 'day' : 'week'
      break
    case '1Y':
      granularity = 'week'
      fromDay = todayDay - 364
      break
    case '5Y':
      granularity = 'month'
      fromDay = todayDay - 1824
      break
    case 'ALL':
      granularity = 'month'
      fromDay = null
      break
  }

  const nowBucket = bucketOf(todayIso, granularity)
  const flow = flowByBucket(feed, linkedAccountIds, granularity)
  const points = walkBuckets(
    anchors,
    flow,
    {
      nowBucket,
      firstBucket: fromDay === null ? null : bucketOf(isoFromDayNumber(fromDay), granularity),
      lastBucket: nowBucket,
    },
    undefined,
    options.expectedSign,
  )
  return { granularity, points: points.map((p) => ({ ...p, start: bucketStart(p.bucket, granularity) })) }
}

/**
 * The whole history — oldest data through today — at one resolution. The zoomable chart computes
 * this once per resolution and slices it as the window moves, so a pinch never re-walks the ledger.
 */
export function computeFullTrend(
  anchors: Map<string, number>,
  feed: FeedItem[],
  linkedAccountIds: Set<string>,
  granularity: Granularity,
  today: Date = new Date(),
  options: { expectedSign?: Map<string, 1 | -1> } = {},
): TrendPoint[] {
  const nowBucket = bucketOf(localIso(today), granularity)
  const flow = flowByBucket(feed, linkedAccountIds, granularity)
  return walkBuckets(anchors, flow, { nowBucket, firstBucket: null, lastBucket: nowBucket }, undefined, options.expectedSign).map(
    (p) => ({ ...p, start: bucketStart(p.bucket, granularity) }),
  )
}

/** Net worth and its change for each point of a trend — the line, summed from the accounts. */
export function trendNetWorth(points: Pick<TrendPoint, 'balances' | 'startBalances'>[]): { netWorth: number; change: number }[] {
  const sum = (balances: Map<string, number>) => {
    let total = 0
    for (const value of balances.values()) total += value
    return round2(total)
  }
  return points.map((p) => {
    const netWorth = sum(p.balances)
    return { netWorth, change: round2(netWorth - sum(p.startBalances)) }
  })
}

/**
 * A trend point's name: short for the x-axis ("Sep 12", "Sep 7", "Sep"), long for the selected
 * point's label ("Sep 12, 2026", "Week of Sep 7, 2026", "Sep 2026").
 */
export function formatTrendLabel(start: string, granularity: Granularity, length: 'short' | 'long'): string {
  const year = start.slice(0, 4)
  const month = MONTH_NAMES[Number(start.slice(5, 7)) - 1]
  const day = Number(start.slice(8, 10))
  if (granularity === 'month') return length === 'short' ? month : `${month} ${year}`
  const date = `${month} ${day}`
  if (length === 'short') return date
  return granularity === 'week' ? `Week of ${date}, ${year}` : `${date}, ${year}`
}

/**
 * Net worth history with some accounts' bands taken from a better source: the investment rebuild,
 * which sees the market where this file's walk cannot (see the note at the top — it carries an
 * investment account's growth flat).
 *
 * Inside a rebuilt series' range an account's balance is the rebuilt value on that day, carried
 * over days the series has no point for (weekends, holidays). Before the range — the rebuild stops
 * where Plaid's activity does — the band starts from the rebuilt value at the range's first day and
 * moves only by what the walk itself saw, its transfers, so the line meets the rebuilt range without
 * a jump. Both `balances` and `startBalances` are rewritten, so a point's change stays its own.
 *
 * `overlays` is keyed like the walk's balances (an account id), each series ascending by date.
 */
export function overlayAccountHistories(
  points: TrendPoint[],
  overlays: Map<string, Array<{ date: string; value: number }>>,
): TrendPoint[] {
  if (overlays.size === 0) return points

  const plans = [...overlays].flatMap(([key, series]) => {
    if (series.length === 0) return []
    const rangeStart = series[0].date
    // The walk's own balance on the rebuilt range's first day: what earlier days are measured from.
    const join = [...points].reverse().find((p) => p.start <= rangeStart) ?? points[0]
    const walkAtJoin = join?.balances.get(key) ?? 0
    const valueOn = (date: string) => {
      let value = series[0].value
      for (const p of series) {
        if (p.date > date) break
        value = p.value
      }
      return value
    }
    // A balance on `date`, given what the walk had for it.
    const rewrite = (date: string, walkValue: number) =>
      date >= rangeStart ? valueOn(date) : round2(series[0].value + (walkValue - walkAtJoin))
    return [{ key, rewrite }]
  })

  return points.map((point) => {
    const balances = new Map(point.balances)
    const startBalances = new Map(point.startBalances)
    const dayBefore = isoFromDayNumber(dayNumber(point.start) - 1)
    for (const { key, rewrite } of plans) {
      balances.set(key, rewrite(point.start, point.balances.get(key) ?? 0))
      startBalances.set(key, rewrite(dayBefore, point.startBalances.get(key) ?? 0))
    }
    return { ...point, balances, startBalances }
  })
}
