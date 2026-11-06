import { useState } from 'react'
import { Text, View } from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import Svg, { Defs, Pattern, Rect } from 'react-native-svg'
import { colors, hexToRgba } from '@/constants/theme'
import { MASKED_AMOUNT } from '@/lib/format/money'
import { useAmountsMasked } from '@/hooks/useAmountsMasked'
import type { BudgetStatus } from '@/lib/budgets/budgetMath'
import { statusColor } from '@/components/budgets/statusColor'
import { Card } from '@/components/ui/Card'

/** Inter's tabular figures: digits all one width, so amounts line up without a monospace face. */
const TABULAR = { fontVariant: ['tabular-nums' as const] }
const BAR_HEIGHT = 10
/** The knob riding the end of what's been spent: a white disc ringed in the health colour. */
const KNOB_SIZE = 18
const KNOB_RING = 3
/** The stripes in the stretch an even pace allows but spending hasn't reached yet. */
const HATCH_GAP = 6
const HATCH_WIDTH = 2

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
 * The month's budgets, at the head of Home's sheet, on a card that opens the Budgets screen: the way in at
 * the top right, then the bar — spent in solid health colour up to a knob,
 * then stripes as far as an even pace would have spent by today (the room still in hand), then the
 * plain track; once past pace the solid runs beyond it (a tick marks the pace point), and once over,
 * past a tick at the limit — and "spent of budgeted" under it.
 *
 * Health is teal on track, amber ahead of pace, rose over (statusColor). With nothing budgeted it's
 * the way in to setting one.
 */
export function BudgetLine({ budget, onPress }: { budget: MonthBudget | null; onPress: () => void }) {
  const { isMasked } = useAmountsMasked()
  const [barWidth, setBarWidth] = useState(0)

  if (!budget) {
    return (
      <Card onPress={onPress} accessibilityLabel="Set a monthly budget" style={{ padding: 16 }}>
        <View className="flex-row items-center gap-3">
          <Text className="flex-1 font-sansSemi text-base text-textPrimary">Set a monthly budget</Text>
          <Ionicons name="chevron-forward" size={16} color={colors.textPrimary} />
        </View>
      </Card>
    )
  }

  const healthColor = statusColor(budget.status)
  const isCurrentMonth = budget.elapsed > 0 && budget.elapsed < 1
  const isOver = budget.spent > budget.budget
  // What an even pace would have spent by today; only meaningful while the month is running.
  const pace = isCurrentMonth ? budget.budget * budget.elapsed : null

  // The bar spans the larger of budget and spending, so going over runs past the limit's tick.
  const scale = Math.max(budget.budget, budget.spent)
  const x = (amount: number) => (scale > 0 ? (Math.min(amount, scale) / scale) * barWidth : 0)
  const spentX = x(budget.spent)
  const paceX = pace != null ? x(pace) : null
  const limitX = x(budget.budget)
  const hatchFrom = spentX
  const hatchTo = paceX != null && paceX > spentX ? paceX : null

  return (
    <Card onPress={onPress} accessibilityLabel="Budgets" style={{ padding: 16, gap: 12 }}>
      <View className="flex-row items-center justify-between gap-3">
        <View className="flex-row items-center gap-3">
          {/* The budget's mark in a round well of its health colour. */}
          <View
            className="items-center justify-center rounded-full"
            style={{
              width: 36,
              height: 36,
              backgroundColor: hexToRgba(healthColor, 0.12),
            }}
          >
            <Ionicons name="pie-chart" size={18} color={healthColor} />
          </View>
          <Text className="font-sansSemi text-base text-textPrimary">Budget</Text>
        </View>
        <View className="flex-row items-center gap-2">
          <View
            className="items-center justify-center rounded-full"
            style={{
              width: 28,
              height: 28,
              backgroundColor: colors.surfaceRaised,
            }}
          >
            <Ionicons name="chevron-forward" size={14} color={colors.textPrimary} />
          </View>
        </View>
      </View>

      <View>
        <View onLayout={(e) => setBarWidth(e.nativeEvent.layout.width)} style={{ height: KNOB_SIZE, justifyContent: 'center' }}>
          {barWidth > 0 ? (
            <>
              {/* The track, then the room an even pace allows (stripes), then what's been spent. */}
              <View
                style={{
                  height: BAR_HEIGHT,
                  borderRadius: BAR_HEIGHT / 2,
                  backgroundColor: hexToRgba(healthColor, 0.12),
                }}
              />
              {hatchTo != null ? (
                <Svg
                  key={`${hatchFrom}-${hatchTo}`}
                  width={hatchTo - hatchFrom}
                  height={BAR_HEIGHT}
                  style={{
                    position: 'absolute',
                    left: hatchFrom,
                    top: (KNOB_SIZE - BAR_HEIGHT) / 2,
                  }}
                >
                  <Defs>
                    <Pattern
                      id="budget-hatch"
                      width={HATCH_GAP}
                      height={HATCH_GAP}
                      patternUnits="userSpaceOnUse"
                      patternTransform="rotate(45)"
                    >
                      <Rect x="0" y="0" width={HATCH_WIDTH} height={HATCH_GAP} fill={hexToRgba(healthColor, 0.45)} />
                    </Pattern>
                  </Defs>
                  <Rect
                    x="0"
                    y="0"
                    width={hatchTo - hatchFrom}
                    height={BAR_HEIGHT}
                    rx={BAR_HEIGHT / 2}
                    fill="url(#budget-hatch)"
                  />
                </Svg>
              ) : null}
              <View
                style={{
                  position: 'absolute',
                  left: 0,
                  top: (KNOB_SIZE - BAR_HEIGHT) / 2,
                  width: Math.max(spentX, BAR_HEIGHT),
                  height: BAR_HEIGHT,
                  borderRadius: BAR_HEIGHT / 2,
                  backgroundColor: healthColor,
                }}
              />
              {isOver ? <Tick x={limitX} color={colors.textPrimary} /> : null}
              {/* Past pace there are no stripes to end at, so the pace point is marked instead. */}
              {paceX != null && hatchTo == null ? <Tick x={paceX} color={colors.textSecondary} /> : null}
              <View
                style={{
                  position: 'absolute',
                  left: Math.min(Math.max(spentX - KNOB_SIZE / 2, 0), barWidth - KNOB_SIZE),
                  top: 0,
                  width: KNOB_SIZE,
                  height: KNOB_SIZE,
                  borderRadius: KNOB_SIZE / 2,
                  borderWidth: KNOB_RING,
                  borderColor: healthColor,
                  backgroundColor: colors.surface,
                }}
              />
            </>
          ) : null}
        </View>
      </View>

      {/* "of … budgeted", not "spent": the budget counts only budgeted categories, so its figure is
          smaller than the month's spending, and two different "spent" amounts read as a bug. */}
      <View className="flex-row items-center justify-between gap-3">
        <Text className="shrink font-sans text-sm text-textPrimary" style={TABULAR} numberOfLines={1}>
          <Text className="font-sansSemi">{dollars(budget.spent, isMasked)}</Text> of {dollars(budget.budget, isMasked)} budgeted
        </Text>
      </View>
    </Card>
  )
}

function Tick({ x, color }: { x: number; color: string }) {
  return (
    <View
      style={{
        position: 'absolute',
        left: x - 1,
        top: (KNOB_SIZE - BAR_HEIGHT) / 2 - 3,
        width: 2,
        height: BAR_HEIGHT + 6,
        borderRadius: 1,
        backgroundColor: color,
      }}
    />
  )
}
