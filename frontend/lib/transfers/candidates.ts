import type { FeedItem } from '@/lib/transactions/resolveFeed'
import { remainingIncome } from '@/lib/reimbursements/suggest'

/**
 * Which feed items may be offered as the other leg when marking `item` as a transfer of any kind.
 * The per-kind rules (amount tolerance, date window, account) live in the registry's `matches`;
 * this is the floor every kind shares — an item that can't be a counterpart at all.
 *
 * Excluded:
 *  - the same sign as `item`, which can't be an opposing leg (and `item` itself);
 *  - anything already committed to a transfer, which can't join a second one;
 *  - an income whose reimbursements have used all of it. One with money left over stays on offer:
 *    an income can be split across several expenses, and its remainder can pay back another. An
 *    expense already partly reimbursed stays on offer too — several incomes may pay one expense back;
 *  - anything already linked to `item`, which would only pair the two a second time.
 *
 * A partly used reimbursement income is only for another reimbursement; the Transfer sheet keeps
 * it out of the other kinds, which pair whole transactions.
 */
export function transferCandidates(feed: FeedItem[], item: FeedItem): FeedItem[] {
  const wantExpense = item.amount < 0
  return feed.filter((candidate) => {
    if (candidate.id === item.id) return false
    if (wantExpense ? candidate.amount <= 0 : candidate.amount >= 0) return false
    if (candidate.transferKind !== null) return false
    if (candidate.isReimbursementIncome && remainingIncome(candidate) < 0.005) return false
    if (candidate.links.some((link) => link.itemId === item.id)) return false
    return true
  })
}
