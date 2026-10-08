import { colors } from '@/constants/theme'
import type { BudgetStatus } from '@/lib/budgets/budgetMath'

/**
 * The health colors, the same three wherever a budget shows: teal on track, amber at risk, rose
 * over. The deep text-safe shades, because these color amounts and labels, not just fills.
 *
 * On track is the brand teal rather than the income green: a "spent" figure in green read as money
 * coming in.
 */
export function statusColor(status: BudgetStatus): string {
  if (status === 'over') return colors.expense
  if (status === 'at-risk') return colors.warning
  return colors.primary
}
