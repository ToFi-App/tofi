import { Text, View } from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import { LinearGradient } from 'expo-linear-gradient'
import { colors, hexToRgba } from '@/constants/theme'
import { MASKED_AMOUNT } from '@/lib/format/money'
import { useAmountsMasked } from '@/hooks/useAmountsMasked'
import type { BudgetStatus } from '@/lib/budgets/budgetMath'
import { statusColor } from '@/components/budgets/statusColor'
import { Card } from '@/components/ui/Card'
import { TileIcon } from '@/components/ui/TileIcon'

/** Inter's tabular figures: digits all one width, so amounts line up without a monospace face. */
const TABULAR = { fontVariant: ['tabular-nums' as const] }
const BAR_HEIGHT = 12
/** How pale the fill starts at the left, as a share of the health colour; it deepens to full at its end. */
const FILL_START_OPACITY = 0.3
/** How far a tick reaches above and below the bar. */
const TICK_OVERHANG = 4

/** Whole dollars: on a summary this size, cents are noise. */
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
 * The month's budgets across the head of Home's sheet: what's left as the card's big number, and a
 * bar of what's been spent of the budget under it — one fill in the month's health colour, pale at
 * the left and deepening to full strength at its end, so the eye lands where spending has got to.
 * A tick marks where an even pace would put spending by today; once over, a dark tick marks the
 * limit and the bar runs on past it. Tapping it opens the Budgets screen.
 *
 * Health is teal on track, amber ahead of pace, rose over (statusColor). With nothing budgeted it's
 * the way in to setting one.
 */
export function BudgetLine({ budget, onPress }: { budget: MonthBudget | null; onPress: () => void }) {
  const { isMasked } = useAmountsMasked()
  // The month's health: the mark's tint and the bar's fill. Brand teal before a budget is set.
  const healthColor = budget ? statusColor(budget.status) : colors.primary

  const header = (
    <View className="flex-row items-center justify-between gap-2">
      <View className="flex-row items-center gap-2">
        <TileIcon name="wallet" color={healthColor} />
        <Text className="font-sansSemi text-base text-textPrimary">Budget</Text>
      </View>
      <View
        className="items-center justify-center rounded-full"
        style={{ width: 24, height: 24, backgroundColor: colors.surfaceRaised }}
      >
        <Ionicons name="chevron-forward" size={13} color={colors.textPrimary} />
      </View>
    </View>
  )

  if (!budget) {
    return (
      <Card onPress={onPress} accessibilityLabel="Set a monthly budget" style={{ padding: 16, gap: 8 }}>
        {header}
        <Text className="font-sans text-sm text-textPrimary">Set a monthly budget</Text>
      </Card>
    )
  }

  const isCurrentMonth = budget.elapsed > 0 && budget.elapsed < 1
  const isOver = budget.spent > budget.budget
  // What an even pace would have spent by today; only meaningful while the month is running.
  const evenPace = isCurrentMonth ? budget.budget * budget.elapsed : null

  // The bar spans the larger of budget and spending, so going over runs past the limit's tick.
  const scale = Math.max(budget.budget, budget.spent)
  const share = (amount: number) => (scale > 0 ? Math.min(amount, scale) / scale : 0)
  const filled = share(budget.spent)
  const left = budget.budget - budget.spent
  const figure = dollars(Math.abs(left), isMasked)
  const context = `${isOver ? 'over' : 'left of'} ${dollars(budget.budget, isMasked)}`

  return (
    <Card onPress={onPress} accessibilityLabel={`Budget. ${figure} ${context}`} style={{ padding: 16, gap: 12 }}>
      {header}

      {/* What's left: the card's one big number, its context beside it. */}
      <View className="flex-row items-baseline gap-2">
        <Text
          className="font-display text-2xl"
          style={[TABULAR, { color: isOver ? colors.expense : colors.textPrimary }]}
          numberOfLines={1}
        >
          {figure}
        </Text>
        <Text className="shrink font-sansMed text-sm text-textPrimary" style={TABULAR} numberOfLines={1}>
          {context}
        </Text>
      </View>

      <View style={{ height: BAR_HEIGHT + TICK_OVERHANG * 2, justifyContent: 'center' }}>
        <View
          style={{ height: BAR_HEIGHT, borderRadius: BAR_HEIGHT / 2, backgroundColor: colors.surfaceRaised, overflow: 'hidden' }}
        >
          {filled > 0 ? (
            // At least as wide as it is tall, so a first small purchase still shows as a rounded nub.
            <LinearGradient
              colors={[hexToRgba(healthColor, FILL_START_OPACITY), healthColor]}
              start={{ x: 0, y: 0.5 }}
              end={{ x: 1, y: 0.5 }}
              style={{ width: `${filled * 100}%`, minWidth: BAR_HEIGHT, height: BAR_HEIGHT, borderRadius: BAR_HEIGHT / 2 }}
            />
          ) : null}
        </View>
        {evenPace != null ? <Tick at={share(evenPace)} color={colors.textSecondary} /> : null}
        {isOver ? <Tick at={share(budget.budget)} color={colors.textPrimary} /> : null}
      </View>

      {/* What the tick means, in words: how far under or over an even pace spending is by today.
          Only while the month runs, and not once the budget is gone. */}
      {evenPace != null && !isOver ? (
        <Text
          className="font-sansMed text-sm"
          style={[TABULAR, { color: evenPace >= budget.spent ? colors.primary : colors.warning }]}
          numberOfLines={1}
        >
          {dollars(Math.abs(evenPace - budget.spent), isMasked)} {evenPace >= budget.spent ? 'under' : 'over'} today&apos;s pace
        </Text>
      ) : null}
    </Card>
  )
}

/** A thin mark across the bar at a share of its length. */
function Tick({ at, color }: { at: number; color: string }) {
  return (
    <View
      style={{
        position: 'absolute',
        left: `${at * 100}%`,
        marginLeft: -1,
        top: 0,
        width: 2,
        height: BAR_HEIGHT + TICK_OVERHANG * 2,
        borderRadius: 1,
        backgroundColor: color,
      }}
    />
  )
}
