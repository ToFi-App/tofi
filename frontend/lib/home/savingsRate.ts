/**
 * The share of the month's income that wasn't spent: (in − out) ÷ in, over the same totals as Home's
 * In and Out pills. Negative when spending outran income; null with no income to measure against.
 */
export function savingsRate(income: number, expense: number): number | null {
  if (income <= 0) return null
  return (income - expense) / income
}

export interface SavingsChange {
  /** 'saved' unless both months spent more than came in; then it's the overspending that's compared. */
  kind: 'saved' | 'overspent'
  /** This month's amount less last month's, in whole dollars: positive is more saved, or more overspent. */
  change: number
}

/**
 * This month against last as what was saved (in − out). Saving can't go below nothing, so a month
 * that spent more than came in counts as $0 saved: last month saving $1,000 and this one overspending
 * $1,000 is "$1,000 less", not $2,000 — the overspend shows on the rate itself. When both months
 * overspent, both would be $0 and read as level however different they were, so then it's the
 * overspending that's compared. Null when last month had no money in or out.
 */
export function savingsChange(
  current: { income: number; expense: number },
  previous: { income: number; expense: number },
): SavingsChange | null {
  if (previous.income <= 0 && previous.expense <= 0) return null
  const kept = current.income - current.expense
  const previousKept = previous.income - previous.expense
  if (kept < 0 && previousKept < 0) return { kind: 'overspent', change: Math.round(previousKept - kept) }
  return { kind: 'saved', change: Math.round(Math.max(kept, 0) - Math.max(previousKept, 0)) }
}
