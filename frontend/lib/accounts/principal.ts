import type { FeedItem } from '@/lib/transactions/resolveFeed'
import type { Holding } from '@/types/domain'
import { accountGain } from './holdings'

/**
 * Net money the user has put into an account: what they contributed, less what they took back out.
 * Null when the account has no transfers at all, so a caller can omit the figure rather than
 * print a meaningless zero.
 *
 * The complement of market value. Market value answers "what is this worth now"; this answers "how
 * much of that is mine rather than growth". Only cash crossing the account boundary is counted,
 * which is exactly what the feed holds for investment accounts — trades never reach it, so a
 * rebalance cannot move this number.
 *
 * Filters to `source === 'investment'` rather than trusting the caller's slice. An investment
 * account's slice should contain nothing else (`/transactions/sync` returns nothing for these
 * accounts), but a plaid row appearing here would be a brokerage-cash movement, and counting it
 * would double-count the transfer that funded it.
 *
 * KNOWN LIMIT: this covers only what the feed holds, and the investments endpoint serves roughly
 * 24 months. On an account held for years it is a window total and understates — potentially by a
 * lot. Do not label it as a lifetime figure anywhere. totalReturn below is built on it knowingly;
 * see the limit restated there.
 */
export function netPrincipal(items: FeedItem[]): number | null {
  let amount = 0
  let found = false

  for (const item of items) {
    if (item.source !== 'investment') continue
    found = true
    // Feed convention is positive-is-money-out, so a contribution is negative and a withdrawal
    // positive. Negating turns that into "money in, net".
    amount -= item.amount
  }

  return found ? amount : null
}

/**
 * Total return: market value minus net deposits, and that as a share of the deposits. Unlike the
 * holdings' unrealized gain, it counts everything the account has made — realized gains that were
 * reinvested (which cost basis absorbs), dividends, interest.
 *
 * Shown as the investment sheet's headline by choice, with its limit accepted: it is only exact
 * when the feed's ~24-month window reaches back to the account's opening. On an older account the
 * pre-window deposits are missing from `principal`, so they read as return and it OVERSTATES.
 * Nothing in the data tells the two cases apart (value minus principal is the very leftover being
 * judged), so there is no guard here — do not add one that compares the figure with itself.
 *
 * No percentage when net deposits are zero or negative (more withdrawn than put in): there is no
 * base to measure against. Null with no transfers at all.
 */
export function totalReturn(value: number, principal: number | null): { gain: number; pct: number | null } | null {
  if (principal === null) return null
  const gain = Math.round((value - principal) * 100) / 100
  return { gain, pct: principal > 0 ? gain / principal : null }
}

/**
 * The investment sheet's headline gain: total return while the account has had more deposited
 * than withdrawn, and the holdings' unrealized gain otherwise.
 *
 * Total return needs a positive base. Once withdrawals exceed deposits (or no transfers exist at
 * all) value minus net deposits turns into "everything ever taken out plus what is left", which
 * says nothing about performance — so the figure falls back to the one that does not depend on
 * transfers at all.
 */
export function investmentHeadlineGain(
  value: number,
  principal: number | null,
  holdings: Holding[],
): { gain: number; pct: number | null } | null {
  if (principal !== null && principal > 0) return totalReturn(value, principal)
  return accountGain(holdings)
}
