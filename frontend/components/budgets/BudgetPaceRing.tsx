import { Text, View } from 'react-native'
import Svg, { Circle } from 'react-native-svg'
import { colors } from '@/constants/theme'
import { MASKED_AMOUNT } from '@/lib/format/money'
import { useAmountsMasked } from '@/hooks/useAmountsMasked'

const RING_SIZE = 216
const RING_STROKE = 14
const TABULAR = { fontVariant: ['tabular-nums' as const] }

interface BudgetPaceRingProps {
  totalBudget: number
  totalSpent: number
  /** monthElapsedFraction: 0 for a future month, 1 for a past one, in between for this one. */
  elapsed: number
  /** Days left in the month, today included; null outside the current month. */
  daysLeft: number | null
  /** What's left per remaining day; null outside the current month. */
  dailyAllowance: number | null
  /** Each budgeted category's spending this month, largest first: the spent arc's segments. */
  segments: Array<{ id: string; name: string; color: string; spent: number }>
}

/**
 * The month's budgets as one ring, at the head of the Budgets screen — the old Budgets tab's
 * BudgetOverview. Two arcs share the track: a soft grey one for where an even pace puts spending by
 * today, and over it the solid arc of what's actually been spent — made of each budgeted category's
 * spending, end to end in its own colour, so the ring says what the money went to as well as how
 * much. Solid short of grey is money in hand; solid past grey is the month running hot. What's left
 * sits in the middle, and how far off today's pace the month is reads under the ring, in the health
 * colour.
 */
export function BudgetPaceRing({ totalBudget, totalSpent, elapsed, daysLeft, dailyAllowance, segments }: BudgetPaceRingProps) {
  const { isMasked } = useAmountsMasked()
  const remaining = totalBudget - totalSpent
  const isOver = remaining < 0
  const isCurrentMonth = elapsed > 0 && elapsed < 1
  const isPastMonth = elapsed >= 1

  const center = RING_SIZE / 2
  const radius = (RING_SIZE - RING_STROKE) / 2
  const circumference = 2 * Math.PI * radius
  const arc = (portion: number, start = 0) => ({
    cx: center,
    cy: center,
    r: radius,
    strokeWidth: RING_STROKE,
    fill: 'none',
    strokeDasharray: `${circumference * portion} ${circumference}`,
    strokeDashoffset: -circumference * start,
    transform: `rotate(-90 ${center} ${center})`,
  })

  // The spent arc as consecutive segments, each its category's share of the budget. Over budget, the
  // ring is the spending instead, so the segments still fill it exactly once.
  const scale = Math.max(totalBudget, totalSpent)
  let cursor = 0
  const arcs = segments
    .filter((seg) => seg.spent > 0 && scale > 0)
    .map((seg) => {
      const portion = seg.spent / scale
      const start = cursor
      cursor += portion
      return { ...seg, portion, start }
    })

  // Where the calendar says spending should be by today, against where it is.
  const paceGap = totalBudget * elapsed - totalSpent
  // Whole dollars, as Home's Budget card shows them, so the two read the same figure.
  const money = (amount: number) => (isMasked ? MASKED_AMOUNT : `$${Math.round(amount).toLocaleString('en-US')}`)

  return (
    <View className="items-center gap-4">
      <View style={{ width: RING_SIZE, height: RING_SIZE }} className="items-center justify-center">
        <Svg width={RING_SIZE} height={RING_SIZE} style={{ position: 'absolute' }}>
          <Circle cx={center} cy={center} r={radius} stroke={colors.border} strokeWidth={RING_STROKE} fill="none" />
          {isCurrentMonth ? <Circle {...arc(elapsed)} stroke={colors.borderStrong} /> : null}
          {arcs.map((seg) => (
            <Circle key={seg.id} {...arc(seg.portion, seg.start)} stroke={seg.color} />
          ))}
        </Svg>

        <View className="items-center gap-1" style={{ maxWidth: RING_SIZE - RING_STROKE * 2 - 24 }}>
          {/* Labels in Inter (design.md: mono is for amounts in lists); context in textSecondary —
              textMuted is reserved for placeholder and disabled text. */}
          <Text className="font-sansMed text-sm text-textSecondary">
            {isOver ? 'Over budget' : isPastMonth ? 'Left over' : 'Left to spend'}
          </Text>
          <Text
            className="font-display text-xl"
            style={[TABULAR, { color: isOver ? colors.expense : colors.textPrimary }]}
            numberOfLines={1}
            adjustsFontSizeToFit
          >
            {money(Math.abs(remaining))}
          </Text>
          <Text className="font-sansMed text-sm text-textSecondary" style={TABULAR}>
            {isOver ? 'past' : 'of'} {money(totalBudget)}
          </Text>
          {daysLeft != null ? (
            <Text className="font-sansMed text-sm text-textSecondary">
              {daysLeft} {daysLeft === 1 ? 'day' : 'days'} left
            </Text>
          ) : null}
        </View>
      </View>

      {/* Pace stops meaning anything once the month's budget is gone; the ring already says so. */}
      {/* No dot separator between the two (design.md): the pace in its health colour, then what it
          leaves per day under it in the context weight and colour. */}
      {isCurrentMonth && !isOver ? (
        <View className="items-center gap-0.5">
          <Text className="font-sansSemi text-base" style={[TABULAR, { color: paceGap >= 0 ? colors.primary : colors.warning }]}>
            {money(Math.abs(paceGap))} {paceGap >= 0 ? 'under' : 'over'} today&apos;s pace
          </Text>
          {dailyAllowance != null ? (
            <Text className="font-sansMed text-sm text-textSecondary" style={TABULAR}>
              {money(dailyAllowance)} a day to stay on budget
            </Text>
          ) : null}
        </View>
      ) : isPastMonth && totalBudget > 0 ? (
        <Text className="text-center font-sansMed text-sm text-textSecondary">
          {Math.round((totalSpent / totalBudget) * 100)}% of your budgets used
        </Text>
      ) : null}

      {/* Which colour is which: the categories the spent arc is made of. */}
      {arcs.length > 0 ? (
        <View className="flex-row flex-wrap justify-center" style={{ columnGap: 14, rowGap: 6 }}>
          {arcs.map((seg) => (
            <View key={seg.id} className="flex-row items-center gap-1.5">
              <View style={{ width: 9, height: 9, borderRadius: 2, backgroundColor: seg.color }} />
              <Text className="font-sans text-sm text-textSecondary">{seg.name}</Text>
            </View>
          ))}
        </View>
      ) : null}
    </View>
  )
}
