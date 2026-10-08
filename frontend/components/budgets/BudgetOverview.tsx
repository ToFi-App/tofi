import { Text, View } from 'react-native'
import Svg, { Circle } from 'react-native-svg'
import { colors } from '@/constants/theme'
import { formatAmount } from '@/lib/format/money'
import type { BudgetStatus } from '@/lib/budgets/budgetMath'
import { Eyebrow } from './Eyebrow'
import { statusColor } from './statusColor'

const RING_SIZE = 216
const RING_STROKE = 14

interface BudgetOverviewProps {
  totalBudget: number
  totalSpent: number
  status: BudgetStatus
  /** monthElapsedFraction: 0 for a future month, 1 for a past one, in between for this one. */
  elapsed: number
  /** Days left in the month, today included; null outside the current month. */
  daysLeft: number | null
  /** What's left per remaining day; null outside the current month. */
  dailyAllowance: number | null
}

/**
 * The month's budgets as one ring. Two arcs share the track: a soft grey one for where an even pace
 * puts spending by today, and over it the solid arc of what's actually been spent, in the health
 * color. Solid short of grey is money in hand; solid past grey is the month running hot. What's left
 * sits in the middle, the biggest number on the page.
 */
export function BudgetOverview({ totalBudget, totalSpent, status, elapsed, daysLeft, dailyAllowance }: BudgetOverviewProps) {
  const remaining = totalBudget - totalSpent
  const isOver = remaining < 0
  const isCurrentMonth = elapsed > 0 && elapsed < 1
  const isPastMonth = elapsed >= 1
  const arcColor = statusColor(status)

  const center = RING_SIZE / 2
  const radius = (RING_SIZE - RING_STROKE) / 2
  const circumference = 2 * Math.PI * radius
  const fraction = totalBudget > 0 ? Math.min(totalSpent / totalBudget, 1) : 0

  const arc = (portion: number) => ({
    cx: center,
    cy: center,
    r: radius,
    strokeWidth: RING_STROKE,
    fill: 'none',
    strokeDasharray: `${circumference * portion} ${circumference}`,
    transform: `rotate(-90 ${center} ${center})`,
  })

  // Where the calendar says spending should be by today, against where it is.
  const paceGap = totalBudget * elapsed - totalSpent

  return (
    <View className="items-center gap-4">
      <View style={{ width: RING_SIZE, height: RING_SIZE }} className="items-center justify-center">
        <Svg width={RING_SIZE} height={RING_SIZE} style={{ position: 'absolute' }}>
          <Circle cx={center} cy={center} r={radius} stroke={colors.border} strokeWidth={RING_STROKE} fill="none" />
          {isCurrentMonth ? <Circle {...arc(elapsed)} stroke={colors.borderStrong} /> : null}
          {fraction > 0 ? <Circle {...arc(fraction)} stroke={arcColor} strokeLinecap="round" /> : null}
        </Svg>

        <View className="items-center gap-1" style={{ maxWidth: RING_SIZE - RING_STROKE * 2 - 24 }}>
          <Eyebrow>{isOver ? 'Over budget' : isPastMonth ? 'Left over' : 'Left to spend'}</Eyebrow>
          <Text
            className="font-display text-xl"
            style={{ color: isOver ? colors.expense : colors.textPrimary }}
            numberOfLines={1}
            adjustsFontSizeToFit
          >
            {formatAmount(Math.abs(remaining))}
          </Text>
          <Text className="font-mono text-xs text-textMuted">
            {isOver ? 'past' : 'of'} {formatAmount(totalBudget)}
          </Text>
          {daysLeft != null ? (
            <Text className="font-sans text-xs text-textSecondary">
              {daysLeft} {daysLeft === 1 ? 'day' : 'days'} left
            </Text>
          ) : null}
        </View>
      </View>

      {/* Pace stops meaning anything once the month's budget is gone; the ring already says so. */}
      {isCurrentMonth && !isOver ? (
        <Text className="text-center font-sansSemi text-sm" style={{ color: paceGap >= 0 ? colors.primary : colors.warning }}>
          {formatAmount(Math.abs(paceGap))} {paceGap >= 0 ? 'under' : 'over'} today&apos;s pace
          {dailyAllowance != null ? <Text className="font-sans text-textMuted"> · {formatAmount(dailyAllowance)} a day</Text> : null}
        </Text>
      ) : isPastMonth && totalBudget > 0 ? (
        <Text className="text-center font-sans text-sm text-textMuted">
          {Math.round((totalSpent / totalBudget) * 100)}% of your budgets used
        </Text>
      ) : null}
    </View>
  )
}
