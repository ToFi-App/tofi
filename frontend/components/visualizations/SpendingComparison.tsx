import { useMemo, useState } from 'react'
import { Text, View } from 'react-native'
import { useMMKVString } from 'react-native-mmkv'
import Svg, { Circle, ClipPath, Defs, Line, LinearGradient, Path, Rect, Stop } from 'react-native-svg'
import { colors, hexToRgba } from '@/constants/theme'
import { MASKED_AMOUNT } from '@/lib/format/money'
import { useAmountsMasked } from '@/hooks/useAmountsMasked'
import { monotoneLine } from '@/lib/charts/lineChart'
import { totalThrough, type MonthComparison } from '@/lib/budgets/monthComparison'
import { shiftMonth, type YearMonth } from '@/lib/transactions/filterByMonth'
import { SPENDING_CHART_VIEW_KEY, preferences } from '@/lib/storage/preferences'
import { IconSwitch, type IconSwitchOption } from '@/components/ui/IconSwitch'
import { LineLayer, LiveDot } from './TrendLine'
import { Card } from '@/components/ui/Card'

const CHART_HEIGHT = 56
const CARD = { padding: 16, gap: 12 }
/** Inter's tabular figures: digits all one width, so amounts line up without a monospace face. */
const TABULAR = { fontVariant: ['tabular-nums' as const] }
/** How much of each half the gap line may use, so its peak and the end dot clear the edges. */
const HEADROOM = 0.82
/** Room past the line's last day for its end dot. */
const PLOT_RIGHT = 6
/**
 * The smallest gap that fills the chart, as a share of last month's whole spending. Without it the
 * scale fits whatever the gap is, and a month's first purchase always shoots to the edge.
 */
const MIN_REACH_SHARE = 0.2
/** Under a cent either way is level: the totals are sums of cents, and float drift isn't news. */
const LEVEL = 0.005

/** The point under a finger, marked as the trend charts mark theirs: a tinted halo round a ringed dot. */
function ScrubMarker({ x, y, color }: { x: number; y: number; color: string }) {
  return (
    <>
      <Circle cx={x} cy={y} r={9} fill={hexToRgba(color, 0.18)} />
      <Circle cx={x} cy={y} r={5} fill={colors.surface} stroke={color} strokeWidth={2.5} />
    </>
  )
}

type ChartView = 'gap' | 'total'

const VIEW_OPTIONS: Array<IconSwitchOption<ChartView>> = [
  { value: 'gap', icon: 'swap-vertical-outline', label: 'Ahead or behind last month' },
  { value: 'total', icon: 'trending-up-outline', label: 'Running totals' },
]

function monthName(month: YearMonth, style: 'long' | 'short'): string {
  return new Date(month.year, month.month - 1, 1).toLocaleDateString('en-US', { month: style })
}

interface SpendingComparisonProps {
  month: YearMonth
  comparison: MonthComparison
  isCurrentMonth: boolean
}

/**
 * This month's spending against last month's, on a card laid out like the Budget card above it:
 * header, chart, then one figure line ("$72 less than October so far"). Two chart views, switched by the
 * small icons in the header (and remembered on the device):
 *
 * - Gap: last month is the dashed line across the middle, and the line is how far ahead of it
 *   (above, red) or behind it (below, green) this month's running total was on each day.
 * - Totals: both months' running totals, smoothed — this month solid, last month dashed.
 *
 * Touching the chart reads that day into the figure line. The line is a whole sentence, so early in
 * a month, when the chart is only a few days long, it still says where things stand.
 */
export function SpendingComparison({ month, comparison, isCurrentMonth }: SpendingComparisonProps) {
  const [width, setWidth] = useState(0)
  const [scrubDay, setScrubDay] = useState<number | null>(null)
  const [storedView, setStoredView] = useMMKVString(SPENDING_CHART_VIEW_KEY, preferences)
  const view: ChartView = storedView === 'total' ? 'total' : 'gap'
  const { isMasked } = useAmountsMasked()
  const previousMonth = shiftMonth(month, -1)
  const { current, previous } = comparison
  const daysInMonth = new Date(month.year, month.month, 0).getDate()
  const previousDays = new Date(previousMonth.year, previousMonth.month, 0).getDate()
  const throughDay = current.at(-1)?.day ?? 0
  const previousTotal = previous.at(-1)?.total ?? 0
  const hasHistory = previousTotal > 0

  // The gap on each day from the 1st through the last day counted, starting level on day 0. Last
  // month may be shorter: past its end, its total stays where it finished.
  const gaps = useMemo(
    () =>
      Array.from({ length: throughDay + 1 }, (_, day) => ({
        day,
        gap: totalThrough(current, day) - totalThrough(previous, Math.min(day, previousDays)),
      })),
    [current, previous, throughDay, previousDays],
  )

  const plotWidth = Math.max(0, width - PLOT_RIGHT)
  const x = (day: number) => (Math.min(day, daysInMonth) / daysInMonth) * plotWidth

  // Gap view: centred on last month.
  const mid = CHART_HEIGHT / 2
  const reach = Math.max(1, previousTotal * MIN_REACH_SHARE, ...gaps.map((g) => Math.abs(g.gap)))
  const yGap = (gap: number) => mid - (gap / reach) * mid * HEADROOM
  const gapLine = monotoneLine(gaps.map((g) => ({ x: x(g.day), y: yGap(g.gap) })))
  // The area between the line and the middle, coloured by which side of it each part falls on.
  const gapArea = gapLine ? `${gapLine} L ${x(throughDay)} ${mid} L 0 ${mid} Z` : ''

  // Totals view: both running totals from zero, on one scale.
  const base = CHART_HEIGHT - 2
  const top = Math.max(1, previousTotal, totalThrough(current, throughDay))
  const yTotal = (total: number) => base - (total / top) * (CHART_HEIGHT - 8)
  const totalPoints = (points: MonthComparison['current'], lastDay: number) =>
    Array.from({ length: lastDay + 1 }, (_, day) => ({ x: x(day), y: yTotal(totalThrough(points, day)) }))
  const currentLine = monotoneLine(totalPoints(current, throughDay))
  const previousLine = monotoneLine(totalPoints(previous, previousDays))
  const currentArea = currentLine ? `${currentLine} L ${x(throughDay)} ${base} L 0 ${base} Z` : ''

  const readDay = scrubDay != null ? Math.min(scrubDay, throughDay) : throughDay
  const readPreviousDay = Math.min(readDay, previousDays)
  const readGap = gaps[readDay]?.gap ?? 0
  // The line takes the colour of where the month has ended up, as a trend line follows its last point:
  // green while under last month, red once over it.
  const latestGap = gaps[throughDay]?.gap ?? 0
  const gapColor = latestGap > LEVEL ? colors.expense : latestGap < -LEVEL ? colors.income : colors.textSecondary
  const prevName = monthName(previousMonth, 'long')

  /** Whole dollars, as Budget's line above prints them: on a summary line cents are noise. */
  const dollars = (amount: number) => (isMasked ? MASKED_AMOUNT : `$${Math.round(amount).toLocaleString('en-US')}`)

  /** The gap as an amount and its direction — "$84" "more than" — the amount in its side's colour. */
  function describe(gap: number): { amount: string | null; words: string; color: string } {
    if (Math.abs(gap) < LEVEL) return { amount: null, words: 'Level with', color: colors.textSecondary }
    return gap > 0
      ? { amount: dollars(gap), words: 'more than', color: colors.expense }
      : { amount: dollars(-gap), words: 'less than', color: colors.income }
  }

  function scrubAt(locationX: number) {
    if (plotWidth <= 0 || throughDay === 0) return
    setScrubDay(Math.min(throughDay, Math.max(1, Math.round((locationX / plotWidth) * daysInMonth))))
  }

  // Built like the Budget card above it — title, and its one control at the right — so the two
  // pacing cards read as a pair rather than two different kinds of thing stacked together.
  const labelRow = (
    <View className="flex-row items-center gap-3">
      <Text className="flex-1 font-sansSemi text-base text-textPrimary" numberOfLines={1}>
        Spending vs {prevName}
      </Text>
      {hasHistory ? <IconSwitch size="sm" options={VIEW_OPTIONS} value={view} onChange={setStoredView} /> : null}
    </View>
  )

  if (!hasHistory) {
    return (
      <Card style={CARD}>
        {labelRow}
        <Text className="font-sans text-sm text-textSecondary">Nothing from {prevName} to compare with yet.</Text>
      </Card>
    )
  }

  const reading = describe(readGap)
  /** The day being touched, as a lead-in: "Nov 3 ". Empty at rest. */
  const dayLead = scrubDay != null ? `${monthName(month, 'short')} ${readDay}  ` : ''
  /** Who it's measured against: the whole month at rest, the same day while touching. */
  const against = scrubDay != null ? `${monthName(previousMonth, 'short')} ${readPreviousDay}` : prevName

  return (
    <Card style={CARD}>
      {labelRow}

      <View
        onLayout={(e) => setWidth(e.nativeEvent.layout.width)}
        style={{ height: CHART_HEIGHT }}
        // The responder rather than a gesture handler: a touch reads a day and a drag scrubs. It lets
        // go when the page asks, so a vertical swipe that starts on the chart still scrolls Home.
        onStartShouldSetResponder={() => true}
        onMoveShouldSetResponder={() => true}
        onResponderTerminationRequest={() => true}
        onResponderTerminate={() => setScrubDay(null)}
        onResponderGrant={(e) => scrubAt(e.nativeEvent.locationX)}
        onResponderMove={(e) => scrubAt(e.nativeEvent.locationX)}
        onResponderRelease={() => setScrubDay(null)}
      >
        {/* Drawn in the trend charts' own language (TrendLine): a thin line in its direction's
            colour, a fill that fades away from it, a pulsing dot at today, and the same ringed
            marker under a finger. */}
        {width > 0 && view === 'gap' ? (
          <Svg width={width} height={CHART_HEIGHT}>
            <Defs>
              <ClipPath id="gap-above">
                <Rect x={0} y={0} width={width} height={mid} />
              </ClipPath>
              <ClipPath id="gap-below">
                <Rect x={0} y={mid} width={width} height={mid} />
              </ClipPath>
              {/* Each side fades toward last month's line: strongest where the month ran furthest
                  over (red, above) or under (green, below), gone at the dashed line. */}
              <LinearGradient id="gap-over" x1="0" y1="0" x2="0" y2={mid} gradientUnits="userSpaceOnUse">
                <Stop offset="0" stopColor={colors.expense} stopOpacity={0.22} />
                <Stop offset="1" stopColor={colors.expense} stopOpacity={0} />
              </LinearGradient>
              <LinearGradient id="gap-under" x1="0" y1={CHART_HEIGHT} x2="0" y2={mid} gradientUnits="userSpaceOnUse">
                <Stop offset="0" stopColor={colors.income} stopOpacity={0.22} />
                <Stop offset="1" stopColor={colors.income} stopOpacity={0} />
              </LinearGradient>
            </Defs>

            {/* Last month: the line this one is measured from, the whole month across. */}
            <Line x1={0} x2={width} y1={mid} y2={mid} stroke={colors.borderStrong} strokeWidth={1} strokeDasharray="4 4" />

            {gapArea ? (
              <>
                <Path d={gapArea} fill="url(#gap-over)" clipPath="url(#gap-above)" />
                <Path d={gapArea} fill="url(#gap-under)" clipPath="url(#gap-below)" />
                <Path d={gapLine} stroke={gapColor} strokeWidth={1.5} strokeLinejoin="round" strokeLinecap="round" fill="none" />
              </>
            ) : null}

            {scrubDay != null ? (
              <>
                <Line x1={x(readDay)} x2={x(readDay)} y1={0} y2={CHART_HEIGHT} stroke={colors.textSecondary} strokeWidth={1} opacity={0.7} />
                <ScrubMarker x={x(readDay)} y={yGap(readGap)} color={gapColor} />
              </>
            ) : (
              <LiveDot x={x(throughDay)} y={yGap(gaps[throughDay]?.gap ?? 0)} color={gapColor} />
            )}
          </Svg>
        ) : null}

        {width > 0 && view === 'total' ? (
          <Svg width={width} height={CHART_HEIGHT}>
            <Line x1={0} x2={plotWidth} y1={base} y2={base} stroke={colors.border} strokeWidth={1} />
            {previousLine ? <Path d={previousLine} stroke={colors.textMuted} strokeWidth={1.5} strokeDasharray="4 4" fill="none" /> : null}
            {currentLine ? <LineLayer gradientId="spending-total" areaPath={currentArea} linePath={currentLine} lineColor={colors.expense} /> : null}

            {scrubDay != null ? (
              <>
                <Line x1={x(readDay)} x2={x(readDay)} y1={0} y2={base} stroke={colors.textSecondary} strokeWidth={1} opacity={0.7} />
                <Circle cx={x(readPreviousDay)} cy={yTotal(totalThrough(previous, readPreviousDay))} r={3} fill={colors.surface} stroke={colors.textMuted} strokeWidth={1.5} />
                <ScrubMarker x={x(readDay)} y={yTotal(totalThrough(current, readDay))} color={colors.expense} />
              </>
            ) : (
              <LiveDot x={x(throughDay)} y={yTotal(totalThrough(current, throughDay))} color={colors.expense} />
            )}
          </Svg>
        ) : null}
      </View>

      {/* The figure line, in Budget's style under its bar: the amount bold, the words around it
          regular. A whole sentence, so it never leans on the header to say what it's against. */}
      <Text className="font-sansSemi text-sm text-textPrimary" style={TABULAR} numberOfLines={1}>
        {scrubDay != null && view === 'total' ? (
          <>
            <Text className="font-sans text-textSecondary">{dayLead}</Text>
            <Text style={{ color: colors.expense }}>{dollars(totalThrough(current, readDay))}</Text>
            <Text className="font-sans text-textSecondary">
              {'   '}
              {against}{'  '}
            </Text>
            {dollars(totalThrough(previous, readPreviousDay))}
          </>
        ) : (
          <>
            {dayLead ? <Text className="font-sans text-textSecondary">{dayLead}</Text> : null}
            {reading.amount ? <Text style={{ color: reading.color }}>{reading.amount}</Text> : null}
            <Text className="font-sans text-textSecondary">
              {reading.amount ? ' ' : ''}
              {reading.words} {against}
              {scrubDay == null && isCurrentMonth ? ' so far' : ''}
            </Text>
          </>
        )}
      </Text>
    </Card>
  )
}
