import { Pressable, Text, View } from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg'
import { colors } from '@/constants/theme'
import { MASKED_AMOUNT } from '@/lib/format/money'
import { useAmountsMasked } from '@/hooks/useAmountsMasked'
import type { BudgetStatus } from '@/lib/budgets/budgetMath'
import { statusColor } from '@/components/budgets/statusColor'
import { SectionBadge } from '@/components/ui/SectionBadge'

/** Inter's tabular figures: digits all one width, so amounts line up without a monospace face. */
const TABULAR = { fontVariant: ['tabular-nums' as const] }
const BUDGET_BAR_HEIGHT = 10

/** Whole dollars: on a bar this size, cents are noise. */
function dollars(amount: number, isMasked: boolean): string {
  return isMasked ? MASKED_AMOUNT : `$${Math.round(amount).toLocaleString('en-US')}`
}

export interface MonthBudget {
  budget: number
  spent: number
  status: BudgetStatus
  elapsed: number
}

/**
 * The month's budgets, at the head of Home's sheet: one bar of what's been spent in the health
 * colour — past a tick at the limit once over, with a tick where an even pace would be today — and
 * "spent of budgeted" under it. With nothing budgeted it's the way in to setting one.
 */
export function BudgetLine({ budget, onPress }: { budget: MonthBudget | null; onPress: () => void }) {
  const { isMasked } = useAmountsMasked()
  if (!budget) {
    return (
      <Pressable onPress={onPress} accessibilityRole="button" className="flex-row items-center gap-3">
        <SectionBadge icon="pie-chart" />
        <Text className="flex-1 font-sansSemi text-base text-textPrimary">Set a monthly budget</Text>
        <Ionicons name="chevron-forward" size={16} color={colors.textSecondary} />
      </Pressable>
    )
  }

  // The bar spans the larger of budget and spending, so going over runs past the limit's tick.
  const scale = Math.max(budget.budget, budget.spent)
  const limitAt = scale > 0 ? budget.budget / scale : 1
  const filledTo = scale > 0 ? budget.spent / scale : 0
  const isCurrentMonth = budget.elapsed > 0 && budget.elapsed < 1
  const isOver = budget.spent > budget.budget

  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel="Budgets" className="gap-3">
      <View className="flex-row items-center gap-3">
        <SectionBadge icon="pie-chart" />
        <Text className="flex-1 font-sansSemi text-base text-textPrimary">Budget</Text>
        <Ionicons name="chevron-forward" size={16} color={colors.textSecondary} />
      </View>

      <View>
        <View className="overflow-hidden rounded-full" style={{ height: BUDGET_BAR_HEIGHT, backgroundColor: colors.surfaceRaised }}>
          {/* Faint at the start, full colour where spending has reached: the same fade the trend
              charts use, laid along the bar's length. */}
          {/* Keyed on the width: when the month changes the fill's View resizes, but the Svg inside
              keeps painting at its old size (react-native-svg on the new architecture doesn't redraw
              percentage sizes on a parent resize), so a remount is what makes it draw the new width. */}
          <View className="h-full overflow-hidden rounded-full" style={{ width: `${filledTo * 100}%` }}>
            <Svg key={filledTo} width="100%" height={BUDGET_BAR_HEIGHT}>
              <Defs>
                <LinearGradient id="budget-bar-fill" x1="0" y1="0" x2="1" y2="0">
                  <Stop offset="0" stopColor={statusColor(budget.status)} stopOpacity={0.25} />
                  <Stop offset="1" stopColor={statusColor(budget.status)} stopOpacity={1} />
                </LinearGradient>
              </Defs>
              <Rect x="0" y="0" width="100%" height="100%" fill="url(#budget-bar-fill)" />
            </Svg>
          </View>
        </View>
        {isOver ? <Tick at={limitAt} color={colors.textPrimary} /> : null}
        {/* Where an even pace puts spending by today, lighter than the limit's tick. */}
        {isCurrentMonth ? <Tick at={budget.elapsed * limitAt} color={colors.textSecondary} /> : null}
      </View>

      {/* "of … budgeted", not "spent": the budget counts only budgeted categories, so its figure is
          smaller than the Expenses figure above, and two different "spent" amounts read as a bug. */}
      <Text className="font-sansSemi text-sm text-textPrimary" style={TABULAR}>
        {dollars(budget.spent, isMasked)}{' '}
        <Text className="font-sans text-textSecondary">of</Text> {dollars(budget.budget, isMasked)}{' '}
        <Text className="font-sans text-textSecondary">budgeted</Text>
      </Text>
    </Pressable>
  )
}

function Tick({ at, color }: { at: number; color: string }) {
  return (
    <View
      style={{
        position: 'absolute',
        left: `${at * 100}%`,
        top: -3,
        width: 2,
        height: BUDGET_BAR_HEIGHT + 6,
        marginLeft: -1,
        borderRadius: 1,
        backgroundColor: color,
      }}
    />
  )
}
