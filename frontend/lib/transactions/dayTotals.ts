import { countsOncePosted, countsTowardTotals } from './totals'
import type { FeedItem } from './resolveFeed'

export interface DayTotals {
  income: number
  expense: number
  /** Pending rows that will count once they post, kept apart from the settled figures. */
  pendingIncome: number
  pendingExpense: number
}

/**
 * One day's IN/OUT split, as every day header renders it — the Transactions tab, the account
 * sheet and the category sheet all call this rather than reducing the rows themselves, so a day
 * can't read as $15.15 on one screen and $301.15 on another.
 *
 * Filters on countsTowardTotals, the same predicate that greys a row's amount out: a day whose
 * only rows are excluded comes back {0, 0}, which is what lets the header say so plainly instead
 * of claiming spend the greyed rows below it don't have.
 *
 * Pending rows are summed separately rather than dropped: a day of nothing but pending charges
 * otherwise reads $0.00 over a list of real spending. They stay out of income/expense, which
 * match the settled balances and every other total in the app.
 *
 * All four figures are positive magnitudes; the sign lives in which field the money landed in.
 */
export function dayTotals(items: FeedItem[]): DayTotals {
  const totals: DayTotals = { income: 0, expense: 0, pendingIncome: 0, pendingExpense: 0 }
  for (const item of items) {
    const settled = countsTowardTotals(item)
    if (!settled && !(item.pending && countsOncePosted(item))) continue
    // Sign off the raw amount, magnitude off the net: a reimbursed expense is still an expense,
    // and it's the netted figure the user actually paid.
    const net = item.netAmount ?? item.amount
    if (item.amount < 0) totals[settled ? 'income' : 'pendingIncome'] += Math.abs(net)
    else totals[settled ? 'expense' : 'pendingExpense'] += net
  }
  return totals
}
