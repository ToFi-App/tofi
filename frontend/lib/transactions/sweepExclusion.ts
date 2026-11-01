import { AUTO_MATCH_WINDOW_DAYS } from '@/lib/transfers/autoMatch'
import type { FeedItem } from './resolveFeed'
import type { InvestmentActivity } from '@/types/domain'

/**
 * Deliberately tighter than autoMatch's 7 days. A sweep is automatic and settles same-day or
 * next-day, so nothing legitimate needs the slack — and since this rule matches on amount alone,
 * every extra day of window is another chance to swallow a real purchase that merely happens to
 * equal a recent inflow. 1 day is the smallest window that still covers an overnight sweep.
 */
const SWEEP_WINDOW_DAYS = 1

/**
 * What an outflow must be tagged as before the amount match below is allowed to drop it.
 *
 * The rule's signal — an equal inflow, same account, same day — is also the exact shape of a bill
 * paid FROM a brokerage cash account: the institution funds the payment by redeeming the core
 * money-market position, and that redemption posts as an inflow of precisely the payment's size.
 * Amount alone therefore cannot tell a sweep into holdings from the spending it was raised to
 * cover, and without this gate the second is dropped as often as the first. Whether a real expense
 * survived came down to whether the institution redeemed in one slice or two.
 *
 * The outflow's own code is what separates them: a sweep moves money into holdings and is tagged
 * as a transfer, while a payment names a merchant and carries that merchant's category.
 *
 * A WHITELIST, and a prefix test would not do: TRANSFER_OUT_TRANSFER_OUT_FROM_APPS is Venmo or
 * Cash App to a person — real money leaving, sharing the prefix. TRANSFER_OUT_WITHDRAWAL is cash
 * out, which gets spent later. Both are deliberately absent.
 *
 * The two narrow codes are here for completeness rather than need: INTERNAL_MOVEMENT_PFC already
 * excludes them on this account type (totals.ts). The generic pair is what this rule is actually
 * for — the codes an institution substitutes for a sweep, which are too broad to exclude globally.
 *
 * An untagged outflow (null) is not admitted. No code is not evidence of a sweep, and leaving the
 * money counted is the mild, self-correcting direction this codebase prefers.
 */
const SWEEP_OUTFLOW_PFC = new Set([
  'TRANSFER_OUT_ACCOUNT_TRANSFER',
  'TRANSFER_OUT_OTHER_TRANSFER_OUT',
  'TRANSFER_OUT_INVESTMENT_AND_RETIREMENT_FUNDS',
  'TRANSFER_OUT_SAVINGS',
])

/** Integer cents, so float amounts are safe as map keys. */
function centsKey(item: FeedItem): number {
  return Math.round(Math.abs(item.amount) * 100)
}

function daysBetween(a: string, b: string): number {
  const ms = Math.abs(new Date(a + 'T00:00:00').getTime() - new Date(b + 'T00:00:00').getTime())
  return Math.round(ms / 86_400_000)
}

/**
 * Marks brokerage-cash outflows that merely mirror an inflow of the exact same amount on the same
 * account — the sweep a cash management account performs when money lands in it.
 *
 * Why amount matching rather than the PFC code: the sweep's code varies by institution, and the
 * generic ones it tends to use (`TRANSFER_OUT_ACCOUNT_TRANSFER`) also cover real spending
 * elsewhere, so keying on the code is either institution-specific or unsafe. The mirrored amount
 * on the same account is the reliable signal.
 *
 * Why autoMatch can't do this: pairAllowed rejects same-account pairs outright, and lifting that
 * globally would let a salary deposit pair with an equal rent payment. Confining it to brokerage
 * cash accounts is what makes amount matching safe here.
 *
 * Deliberately asymmetric — only the outflow is marked. The inflow is frequently real income (a
 * dividend arriving, then swept), and excluding both legs the way a transfer does would erase it.
 *
 * MUST run last, after applyTransfers: an outflow autoMatch already paired is left alone, so this
 * can never contradict a transfer the user confirmed, undid, or that auto-applied.
 */
export function applySweepExclusion(feed: FeedItem[]): FeedItem[] {
  // Inflows are indexed even when they already belong to a transfer: money arriving from linked
  // checking is a legitimate transfer pair, and the sweep that follows it still needs excluding.
  const inflowsByAccountAmount = new Map<string, FeedItem[]>()
  // Every inflow in the feed, keyed by amount alone — the index behind hasCrossAccountMatch.
  const inflowsByAmount = new Map<number, FeedItem[]>()
  for (const candidate of feed) {
    if (candidate.amount >= 0) continue
    const existing = inflowsByAmount.get(centsKey(candidate))
    if (existing) existing.push(candidate)
    else inflowsByAmount.set(centsKey(candidate), [candidate])

    if (!candidate.isBrokerageCashAccount || !candidate.accountId) continue
    const key = `${candidate.accountId}::${centsKey(candidate)}`
    const bucket = inflowsByAccountAmount.get(key)
    if (bucket) bucket.push(candidate)
    else inflowsByAccountAmount.set(key, [candidate])
  }

  /**
   * An equal inflow on a DIFFERENT account, inside autoMatch's window — the shape of a transfer
   * out to another linked account, which by definition a sweep is not: a sweep's counterpart is
   * the holdings, never a second account.
   *
   * autoMatch's 7 days rather than this file's 1: the question here is "could this be the transfer
   * autoMatch pairs?", so the two must agree on the window or a 3-day ACH would be swept away
   * before the pair it belongs to could ever form. Wider costs nothing dangerous — the failure
   * mode is a genuine sweep left counted, which is the direction this codebase prefers.
   */
  function hasCrossAccountMatch(item: FeedItem): boolean {
    const bucket = inflowsByAmount.get(centsKey(item)) ?? []
    return bucket.some(
      (candidate) =>
        candidate.accountId !== item.accountId && daysBetween(item.postedDate, candidate.postedDate) <= AUTO_MATCH_WINDOW_DAYS,
    )
  }

  // One inflow justifies dropping one outflow: two equal sweeps against a single inflow must not
  // both vanish, or spending is understated.
  const consumed = new Set<string>()

  return feed.map((item) => {
    if (!item.isBrokerageCashAccount || !item.accountId) return item
    // Outflows only. A brokerage-cash inflow tagged with an investment code is typically a
    // redemption out of the core money-market fund, sized to match the transfer it funds — so an
    // equal outflow elsewhere is the expected shape of a REAL investment, not evidence against one.
    if (item.amount <= 0) return item
    if (item.transferKind !== null) return item // autoMatch already decided this one
    // Before the amount match: a named purchase is spending whatever inflow it happens to mirror.
    if (item.pfcDetailed === null || !SWEEP_OUTFLOW_PFC.has(item.pfcDetailed)) return item
    if (hasCrossAccountMatch(item)) return { ...item, hasCrossAccountCounterpart: true } // a transfer to pair, not a sweep

    const bucket = inflowsByAccountAmount.get(`${item.accountId}::${centsKey(item)}`) ?? []
    const match = bucket.find(
      (candidate) => !consumed.has(candidate.id) && daysBetween(item.postedDate, candidate.postedDate) <= SWEEP_WINDOW_DAYS,
    )
    if (!match) return item

    consumed.add(match.id)
    return { ...item, isSweptOutflow: true }
  })
}

/**
 * Marks a Plaid cash debit as an investment purchase only when Plaid also reports a stock buy
 * for that exact brokerage account and amount, with dates no more than two days apart. Require a one-to-one match on both
 * sides: the activity endpoint's `amount` is trade cash movement (positive for a buy), while the
 * cash transaction feed also uses positive for money out.
 */
export function applyInvestmentPurchaseLabels(
  feed: FeedItem[],
  activity: Array<InvestmentActivity & { accountId: string }>,
): FeedItem[] {
  const eligibleActivity = activity.filter(
    (row) => row.subtype.toLowerCase() === 'buy' && row.securityId !== null && row.amount > 0,
  )
  const candidates = feed.filter(
    (item) => item.source === 'plaid' && item.isBrokerageCashAccount && item.amount > 0 && !item.pending,
  )
  const day = (date: string) => Date.parse(`${date}T00:00:00Z`)
  const cents = (amount: number) => Math.round(amount * 100)
  // Plaid's transaction date can be the settlement date while investment activity uses trade
  // date. Allow up to two days, but only accept mutual one-to-one matches to avoid collisions.
  const related = (item: FeedItem, row: InvestmentActivity & { accountId: string }) =>
    item.accountId === row.accountId &&
    cents(item.amount) === cents(row.amount) &&
    Math.abs(day(item.postedDate) - day(row.date)) <= 2 * 86_400_000
  const matchesByCash = candidates.map((item) => eligibleActivity.filter((row) => related(item, row)))
  const matchesByActivity = eligibleActivity.map((row) => candidates.filter((item) => related(item, row)))
  const confirmed = new Set<string>()
  candidates.forEach((item, i) => {
    const matches = matchesByCash[i]
    if (matches.length !== 1) return
    const activityIndex = eligibleActivity.indexOf(matches[0])
    if (matchesByActivity[activityIndex]?.length === 1) confirmed.add(item.id)
  })
  return feed.map((item) => (confirmed.has(item.id) ? { ...item, isInvestmentPurchase: true } : item))
}
