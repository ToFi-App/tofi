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

/**
 * A rate as a whole percent, with a true minus sign, for every screen that shows one. Below −100%
 * (spending more than twice what came in) it reads "< −100%": past there the figure measures how
 * small income was rather than anything about spending. 2¢ of interest against $1,000 out is
 * −4,999,900%, which says nothing the Out total and the net don't, and doesn't fit the ring. The
 * ring is already full at −100%, so the label stops where it does. `spoken` words the cap for a
 * screen reader, which reads "<" badly.
 */
export function formatSavingsRate(rate: number, { spoken = false }: { spoken?: boolean } = {}): string {
  const rounded = Math.round(rate * 100)
  if (rounded < -100) return spoken ? 'below −100%' : '< −100%'
  return rounded < 0 ? `−${-rounded}%` : `${rounded}%`
}
