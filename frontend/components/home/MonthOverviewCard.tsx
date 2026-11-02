import { Pressable, Text, View } from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg'
import { colors } from '@/constants/theme'
import { MASKED_AMOUNT, formatAmount, formatMaskableAmount } from '@/lib/format/money'
import { useAmountsMasked } from '@/hooks/useAmountsMasked'
import { MaskToggle } from '@/components/ui/MaskToggle'
import type { BudgetStatus } from '@/lib/budgets/budgetMath'
import { statusColor } from '@/components/budgets/statusColor'
import type { ReviewPrompt } from '@/lib/cashflow/reviewPrompt'
import { monthLabel, type YearMonth } from '@/lib/transactions/filterByMonth'
import { SpendingComparison } from '@/components/visualizations/SpendingComparison'
import type { MonthComparison } from '@/lib/budgets/monthComparison'

/** Inter's tabular figures: digits all one width, so amounts line up without a monospace face. */
const TABULAR = { fontVariant: ['tabular-nums' as const] }
const BUDGET_BAR_HEIGHT = 10

/** Plus or minus in front; zero goes unsigned, since it's neither money in nor out. */
function signed(amount: number): string {
  if (Math.abs(amount) < 0.005) return formatAmount(0)
  return `${amount < 0 ? '−' : '+'}${formatAmount(Math.abs(amount))}`
}

/** Whole dollars: on a bar this size, cents are noise. */
function dollars(amount: number, isMasked: boolean): string {
  return isMasked ? MASKED_AMOUNT : `$${Math.round(amount).toLocaleString('en-US')}`
}

interface MonthOverviewCardProps {
  month: YearMonth
  totalExpense: number
  totalIncome: number
  /** This month's spending against last month's, for the pace chart. */
  comparison: MonthComparison
  isCurrentMonth: boolean
  /** The month's budgets summed; null when nothing is budgeted. */
  budget: {
    budget: number
    spent: number
    status: BudgetStatus
    elapsed: number
  } | null
  review: ReviewPrompt
  onReviewPress: (month: YearMonth) => void
  onBudgetPress: () => void
}

/**
 * The month at the top of Home, open on the page. The net, signed and coloured, with the money in and out labelled under it; the
 * month's spending against last month's, as the gap between them; and below a rule, the budgets as one thin bar.
 * The cash flow review rides in the corner, filled at the turn of the month (reviewPrompt).
 */
export function MonthOverviewCard({
  month,
  totalExpense,
  totalIncome,
  comparison,
  isCurrentMonth,
  budget,
  review,
  onReviewPress,
  onBudgetPress,
}: MonthOverviewCardProps) {
  const { isMasked } = useAmountsMasked()
  const net = totalIncome - totalExpense
  const reviewName = monthLabel(review.month).split(' ')[0]

  return (
    // On the page itself, like Net Worth's and Investments' headline and chart — no card around it.
    <View>
      <View className="gap-1">
        {/* The pill sits in the number's own row, centred on it — aligned to the block's top it
            floated above the figure, whose line box starts higher than its digits. */}
        <View className="flex-row items-center justify-between">
          {/* The figure and its eye are one tap target, as on Net Worth and Investments. */}
          <MaskToggle>
            <Text className="shrink font-display text-2xl" style={{ color: net >= 0 ? colors.income : colors.expense }} numberOfLines={1} adjustsFontSizeToFit>
              {isMasked ? MASKED_AMOUNT : signed(net)}
            </Text>
          </MaskToggle>
          <Pressable
            onPress={() => onReviewPress(review.month)}
            accessibilityRole="button"
            accessibilityLabel={review.isReady ? `${reviewName} cash flow` : 'Cash flow'}
            hitSlop={8}
            className="flex-row items-center gap-1 rounded-full px-2.5 py-1"
            style={{ backgroundColor: review.isReady ? colors.primary : colors.primaryMuted }}
          >
            <Ionicons name="git-network-outline" size={13} color={review.isReady ? colors.textInverse : colors.primary} />
            {review.isReady ? (
              <Text className="font-sansSemi text-xs" style={{ color: colors.textInverse }}>
                Cash Flow
              </Text>
            ) : null}
          </Pressable>
        </View>
        {/* Labelled, so the colour alone doesn't have to say which is which — and unsigned, since
            the label already gives the direction. Only the net above carries a sign. */}
        <View className="flex-row gap-6">
          <View>
            <Text className="font-sans text-xs text-textMuted">Income</Text>
            <Text className="font-sansSemi text-base" style={[TABULAR, { color: colors.income }]}>
              {formatMaskableAmount(totalIncome, isMasked)}
            </Text>
          </View>
          <View>
            <Text className="font-sans text-xs text-textMuted">Expenses</Text>
            <Text className="font-sansSemi text-base" style={[TABULAR, { color: colors.expense }]}>
              {formatMaskableAmount(totalExpense, isMasked)}
            </Text>
          </View>
        </View>
      </View>

      {/* How far this month's spending ran ahead of or behind last month's, day by day. */}
      <View className="mt-5">
        <SpendingComparison month={month} comparison={comparison} isCurrentMonth={isCurrentMonth} />
      </View>

      <View className="my-4 h-px bg-border" />

      <BudgetLine budget={budget} onPress={onBudgetPress} />
    </View>
  )
}

/**
 * The month's budgets: one bar of what's been spent in the health colour — past a tick at the
 * limit once over, with a tick where an even pace would be today — and "spent of budgeted" under it.
 */
function BudgetLine({ budget, onPress }: { budget: MonthOverviewCardProps['budget']; onPress: () => void }) {
  const { isMasked } = useAmountsMasked()
  if (!budget) {
    return (
      <Pressable onPress={onPress} accessibilityRole="button" className="flex-row items-center gap-3">
        <BudgetBadge />
        <Text className="flex-1 font-sansSemi text-base text-textPrimary">Set a monthly budget</Text>
        <Ionicons name="chevron-forward" size={16} color={colors.textSecondary} />
      </Pressable>
    )
  }

  // The bar spans the larger of budget and spending, so going over runs past the limit's tick.
  const scale = Math.max(budget.budget, budget.spent)
  const limitAt = scale > 0 ? budget.budget / scale : 1
  const isCurrentMonth = budget.elapsed > 0 && budget.elapsed < 1
  const isOver = budget.spent > budget.budget

  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel="Budgets" className="gap-3">
      <View className="flex-row items-center gap-3">
        <BudgetBadge />
        <Text className="flex-1 font-sansSemi text-base text-textPrimary">Budget</Text>
        <Ionicons name="chevron-forward" size={16} color={colors.textSecondary} />
      </View>

      <View>
        <View className="overflow-hidden rounded-full" style={{ height: BUDGET_BAR_HEIGHT, backgroundColor: colors.surfaceRaised }}>
          {/* Faint at the start, full colour where spending has reached: the same fade the daily
              bars and the trend charts use, laid along the bar's length. */}
          <View className="h-full overflow-hidden rounded-full" style={{ width: `${(scale > 0 ? budget.spent / scale : 0) * 100}%` }}>
            <Svg width="100%" height={BUDGET_BAR_HEIGHT}>
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

/** The budget's mark: a pie-chart glyph in the brand's tinted well, the tiles' badge style. */
/** The budget's mark: a pie-chart glyph in the brand's tinted well, the tiles' badge style. */
function BudgetBadge() {
  return (
    <View className="h-8 w-8 items-center justify-center rounded-full" style={{ backgroundColor: colors.primaryMuted }}>
      <Ionicons name="pie-chart" size={15} color={colors.primary} />
    </View>
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
