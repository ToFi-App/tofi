import { countsTowardTotals } from './totals'
import type { FeedItem } from './resolveFeed'

export interface MonthAggregate {
  spendByCategory: Map<string, number>
  incomeByCategory: Map<string, number>
  spendByDay: Map<string, { net: number; hasReimbursement: boolean }>
  /**
   * Each day's spending split by category (null for uncategorized), net of reimbursements — what
   * the calendar's category squares draw. Spending only: income leaves no square.
   */
  spendByDayCategory: Map<string, Map<string | null, number>>
  totalExpense: number
  totalIncome: number
}

// Single source of truth for "how do we turn a (month+account-filtered) feed into
// spend/income aggregates" — every screen that shows these numbers must call this,
// not reimplement its own version, so Dashboard/Budgets/Transactions never drift.
//
// Two conventions are fixed here deliberately:
//  - items are classified as expense/income by the sign of their NET amount (post
//    reimbursement), matching what the Transactions calendar always showed;
//  - uncategorized items DO count toward totalExpense/totalIncome and are only left
//    out of the per-category maps, since a running total that silently drops
//    uncategorized spend understates what the user actually spent.
export function aggregateMonth(feed: FeedItem[]): MonthAggregate {
  const spendByCategory = new Map<string, number>()
  const incomeByCategory = new Map<string, number>()
  const spendByDay = new Map<string, { net: number; hasReimbursement: boolean }>()
  const spendByDayCategory = new Map<string, Map<string | null, number>>()
  let totalExpense = 0
  let totalIncome = 0

  for (const item of feed) {
    // Delegates to countsTowardTotals rather than restating its exclusions. This file used to
    // keep a parallel list (internal movement + swept outflow) with a comment claiming the two
    // were exactly that predicate's exclusions. They were, until one was added to the predicate
    // and not here — and the totals then counted rows the list below them had greyed out. One
    // predicate, one place, so the two cannot disagree again.
    //
    // The reimbursement income leg is the single exclusion that must still reach the code below:
    // countsTowardTotals rejects it (its expense is already netted), but it does mark its
    // calendar day as reimbursement-touched. Everything else countsTowardTotals rejects marks
    // nothing — there is nothing about the day for the user to notice.
    if (!item.isReimbursementIncome && !countsTowardTotals(item)) continue

    const net = item.netAmount ?? item.amount
    const existingDay = spendByDay.get(item.date) ?? { net: 0, hasReimbursement: false }
    const hasReimbursement = existingDay.hasReimbursement || item.reimbursedAmount != null || item.isReimbursementIncome

    // A reimbursement's income leg is already netted out of its expense, so counting it
    // again would double-credit it — it only marks the day as reimbursement-touched.
    if (item.isReimbursementIncome) {
      spendByDay.set(item.date, { net: existingDay.net, hasReimbursement })
      continue
    }

    spendByDay.set(item.date, { net: existingDay.net + net, hasReimbursement })

    if (net > 0) {
      totalExpense += net
      const byCategory = spendByDayCategory.get(item.date) ?? new Map<string | null, number>()
      byCategory.set(item.categoryId, (byCategory.get(item.categoryId) ?? 0) + net)
      spendByDayCategory.set(item.date, byCategory)
      if (item.categoryId) {
        spendByCategory.set(item.categoryId, (spendByCategory.get(item.categoryId) ?? 0) + net)
      }
    } else if (net < 0) {
      totalIncome += Math.abs(net)
      if (item.categoryId) {
        incomeByCategory.set(item.categoryId, (incomeByCategory.get(item.categoryId) ?? 0) + Math.abs(net))
      }
    }
  }

  return { spendByCategory, incomeByCategory, spendByDay, spendByDayCategory, totalExpense, totalIncome }
}
