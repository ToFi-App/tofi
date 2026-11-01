import { useState } from 'react'
import { Pressable, Text, View } from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg'
import { colors } from '@/constants/theme'
import { toDateKey } from '@/lib/dates/dateKey'
import { formatAmount } from '@/lib/format/money'
import type { BudgetStatus } from '@/lib/budgets/budgetMath'
import { statusColor } from '@/components/budgets/statusColor'
import type { ReviewPrompt } from '@/lib/cashflow/reviewPrompt'
import { monthLabel, type YearMonth } from '@/lib/transactions/filterByMonth'

const CHART_HEIGHT = 56
const BAR_GAP = 2
/** The bars' fades: colour, opacity at the top, opacity at the base. */
const BAR_FILLS = [
  { id: 'bar-today', color: colors.primary, top: 1, bottom: 0.6 },
  { id: 'bar-big', color: colors.expense, top: 0.9, bottom: 0.5 },
  { id: 'bar-big-future', color: colors.expense, top: 0.35, bottom: 0.18 },
  { id: 'bar-ordinary', color: colors.textSecondary, top: 0.4, bottom: 0.22 },
]
const DAY_TICKS = [1, 8, 15, 22, 29]
/** Inter's tabular figures: digits all one width, so amounts line up without a monospace face. */
const TABULAR = { fontVariant: ['tabular-nums' as const] }
const BUDGET_BAR_HEIGHT = 10

/** Plus or minus in front; zero goes unsigned, since it's neither money in nor out. */
function signed(amount: number): string {
  if (Math.abs(amount) < 0.005) return formatAmount(0)
  return `${amount < 0 ? '−' : '+'}${formatAmount(Math.abs(amount))}`
}

/** Whole dollars: on a bar this size, cents are noise. */
function dollars(amount: number): string {
  return `$${Math.round(amount).toLocaleString('en-US')}`
}

function dateKeyOf(month: YearMonth, day: number): string {
  return `${month.year}-${String(month.month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

interface MonthOverviewCardProps {
  month: YearMonth
  totalExpense: number
  totalIncome: number
  /** aggregateMonth's spendByDay: each day's net, positive for money out. */
  spendByDay: Map<string, { net: number }>
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
  /** The chart opens the month's full calendar. */
  onCalendarPress: () => void
}

/**
 * The month at the top of Home, open on the page. The net, signed and coloured, with the money in and out under it; the
 * month's days as bars of what each spent, against a dashed average — a chart of the month, which
 * a tap opens the month's full calendar; and below a rule, the budgets as one thin bar.
 * The cash flow review rides in the corner, filled at the turn of the month (reviewPrompt).
 */
export function MonthOverviewCard({
  month,
  totalExpense,
  totalIncome,
  spendByDay,
  budget,
  review,
  onReviewPress,
  onBudgetPress,
  onCalendarPress,
}: MonthOverviewCardProps) {
  const [chartWidth, setChartWidth] = useState(0)
  const net = totalIncome - totalExpense
  const reviewName = monthLabel(review.month).split(' ')[0]

  const daysInMonth = new Date(month.year, month.month, 0).getDate()
  const todayKey = toDateKey(new Date())
  const days = Array.from({ length: daysInMonth }, (_, i) => {
    const key = dateKeyOf(month, i + 1)
    return { key, spent: Math.max(0, spendByDay.get(key)?.net ?? 0), isFuture: key > todayKey, isToday: key === todayKey }
  })
  const pastDays = days.filter((d) => !d.isFuture)
  const peak = Math.max(1, ...days.map((d) => d.spent))
  const average = pastDays.length > 0 ? totalExpense / pastDays.length : 0
  const barWidth = chartWidth > 0 ? (chartWidth - BAR_GAP * (daysInMonth - 1)) / daysInMonth : 0
  const xOfDay = (day: number) => (day - 1) * (barWidth + BAR_GAP)

  return (
    // On the page itself, like Net Worth's and Investments' headline and chart — no card around it.
    <View>
      <View className="gap-1">
        {/* The pill sits in the number's own row, centred on it — aligned to the block's top it
            floated above the figure, whose line box starts higher than its digits. */}
        <View className="flex-row items-center justify-between">
          <Text className="shrink font-display text-2xl" style={{ color: net >= 0 ? colors.income : colors.expense }} numberOfLines={1} adjustsFontSizeToFit>
            {signed(net)}
          </Text>
          <Pressable
            onPress={() => onReviewPress(review.month)}
            accessibilityRole="button"
            accessibilityLabel={review.isReady ? `${reviewName} review` : 'Cash flow'}
            hitSlop={8}
            className="flex-row items-center gap-1 rounded-full px-2.5 py-1"
            style={{ backgroundColor: review.isReady ? colors.primary : colors.primaryMuted }}
          >
            <Ionicons name="git-network-outline" size={13} color={review.isReady ? colors.textInverse : colors.primary} />
            {review.isReady ? (
              <Text className="font-sansSemi text-xs" style={{ color: colors.textInverse }}>
                Review
              </Text>
            ) : null}
          </Pressable>
        </View>
        <View className="flex-row gap-3">
          <Text className="font-sansSemi text-base" style={[TABULAR, { color: colors.income }]}>
            {signed(totalIncome)}
          </Text>
          <Text className="font-sansSemi text-base" style={[TABULAR, { color: colors.expense }]}>
            {signed(-totalExpense)}
          </Text>
        </View>
      </View>

      {/* The month's days as bars. Tapping them opens the calendar too — a shortcut to the header's
          calendar icon, which is the way in that doesn't need discovering. */}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Open the calendar"
        onLayout={(e) => setChartWidth(e.nativeEvent.layout.width)}
        onPress={onCalendarPress}
        className="mt-4"
      >
        <View style={{ height: CHART_HEIGHT }}>
          {barWidth > 0 ? (
            <>
              {/* Each bar fades from its colour at the top to nearly nothing at the base, the same
                  falling fill the Net Worth and Investments trend lines sit on. */}
              <Svg width={chartWidth} height={CHART_HEIGHT}>
                <Defs>
                  {BAR_FILLS.map((fill) => (
                    <LinearGradient key={fill.id} id={fill.id} x1="0" y1="0" x2="0" y2="1">
                      <Stop offset="0" stopColor={fill.color} stopOpacity={fill.top} />
                      <Stop offset="1" stopColor={fill.color} stopOpacity={fill.bottom} />
                    </LinearGradient>
                  ))}
                </Defs>
                {days.map((d, i) => {
                  const height = d.spent > 0 ? Math.max(3, (d.spent / peak) * CHART_HEIGHT) : 3
                  // Neutral for an ordinary day; the expense colour only for a day above the
                  // average, so the big days stand out instead of every bar shouting.
                  const fill = d.isToday
                    ? 'url(#bar-today)'
                    : d.spent > average && average > 0
                      ? d.isFuture
                        ? 'url(#bar-big-future)'
                        : 'url(#bar-big)'
                      : d.spent > 0
                        ? 'url(#bar-ordinary)'
                        : colors.surfaceRaised
                  return (
                    <Rect
                      key={d.key}
                      x={xOfDay(i + 1)}
                      y={CHART_HEIGHT - height}
                      width={barWidth}
                      height={height}
                      rx={Math.min(3, barWidth / 2)}
                      fill={fill}
                    />
                  )
                })}
              </Svg>
              {average > 0 ? (
                <View
                  pointerEvents="none"
                  style={{
                    position: 'absolute',
                    left: 0,
                    right: 0,
                    bottom: (average / peak) * CHART_HEIGHT,
                    borderTopWidth: 1,
                    borderStyle: 'dashed',
                    borderColor: colors.borderStrong,
                  }}
                />
              ) : null}
            </>
          ) : null}
        </View>
        <View style={{ height: 16, marginTop: 4 }}>
          {barWidth > 0
            ? DAY_TICKS.filter((day) => day <= daysInMonth).map((day) => (
                <Text
                  key={day}
                  className="font-sansMed text-xs text-textSecondary"
                  style={[TABULAR, { position: 'absolute', left: xOfDay(day), width: Math.max(barWidth, 16) }]}
                >
                  {day}
                </Text>
              ))
            : null}
        </View>
      </Pressable>

      <View className="my-4 h-px bg-border" />

      <BudgetLine budget={budget} onPress={onBudgetPress} />
    </View>
  )
}

/**
 * The month's budgets as one thin bar: spent against the total, coloured by health, with a tick
 * where an even pace would be today, and the spent and budgeted figures at its ends.
 */
/**
 * The month's budgets: one bar of what's been spent in the health colour — past a tick at
 * the limit once over — and the totals at its ends.
 */
function BudgetLine({ budget, onPress }: { budget: MonthOverviewCardProps['budget']; onPress: () => void }) {
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


      <View className="flex-row justify-between">
        <Text className="font-sansSemi text-sm text-textPrimary" style={TABULAR}>
          {dollars(budget.spent)} <Text className="font-sans">spent</Text>
        </Text>
        <Text className="font-sansSemi text-sm text-textSecondary" style={TABULAR}>
          {dollars(budget.budget)} <Text className="font-sans">budgeted</Text>
        </Text>
      </View>
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
