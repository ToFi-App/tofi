import { useMemo, useState } from 'react'
import { Text, View } from 'react-native'
import { Gesture, GestureDetector } from 'react-native-gesture-handler'
import { Ionicons } from '@expo/vector-icons'
import Svg, { Circle, ClipPath, Defs, Line, LinearGradient, Path, Rect, Stop } from 'react-native-svg'
import { colors, hexToRgba } from '@/constants/theme'
import { MASKED_AMOUNT } from '@/lib/format/money'
import { useAmountsMasked } from '@/hooks/useAmountsMasked'
import { monotoneLine } from '@/lib/charts/lineChart'
import { totalThrough, type MonthComparison } from '@/lib/budgets/monthComparison'
import { shiftMonth, type YearMonth } from '@/lib/transactions/filterByMonth'
import { LiveDot } from './TrendLine'
import { Card } from '@/components/ui/Card'
import { TileIcon } from '@/components/ui/TileIcon'

const CHART_HEIGHT = 56
const CARD = { padding: 14, gap: 8 }
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

function monthName(month: YearMonth, style: 'long' | 'short'): string {
  return new Date(month.year, month.month - 1, 1).toLocaleDateString('en-US', { month: style })
}

interface SpendingComparisonProps {
  month: YearMonth
  comparison: MonthComparison
}

/**
 * This month's spending against last month's, as a tile beside Savings rate on Home: header, the gap
 * as one big figure (an arrow and "$72", green under last month, red over) with "vs Oct" after it, then the chart:
 * last month is the dashed line across the middle, and the line is how far ahead of it (above, red)
 * or behind it (below, green) this month's running total was on each day — the same gap as the
 * figure, drawn over the month.
 *
 * One view: the tile is half the sheet wide, and its icon, title and a switch between views didn't
 * fit across it. The running totals of both months are in Charts, a tap away.
 *
 * Touching the chart reads that day into the figure, with the day beside it.
 */
export function SpendingComparison({ month, comparison }: SpendingComparisonProps) {
  const [width, setWidth] = useState(0)
  const [scrubDay, setScrubDay] = useState<number | null>(null)
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

  const readDay = scrubDay != null ? Math.min(scrubDay, throughDay) : throughDay
  const readGap = gaps[readDay]?.gap ?? 0
  // The line takes the colour of where the month has ended up, as a trend line follows its last point:
  // green while under last month, red once over it.
  const latestGap = gaps[throughDay]?.gap ?? 0
  const gapColor = latestGap > LEVEL ? colors.expense : latestGap < -LEVEL ? colors.income : colors.textSecondary

  /** Whole dollars, as Budget's line above prints them: on a summary line cents are noise. */
  const dollars = (amount: number) => (isMasked ? MASKED_AMOUNT : `$${Math.round(amount).toLocaleString('en-US')}`)

  /** The gap as an amount, in its side's colour: red over last month, green under. */
  function describe(gap: number): { amount: string | null; color: string } {
    if (Math.abs(gap) < LEVEL) return { amount: null, color: colors.textSecondary }
    return gap > 0 ? { amount: dollars(gap), color: colors.expense } : { amount: dollars(-gap), color: colors.income }
  }

  function scrubAt(locationX: number) {
    if (plotWidth <= 0 || throughDay === 0) return
    setScrubDay(Math.min(throughDay, Math.max(1, Math.round((locationX / plotWidth) * daysInMonth))))
  }

  // A touch reads a day and a sideways drag scrubs. It claims sideways movement sooner than a swipe
  // between Home's views does, so a scrub stays a scrub; vertical movement lets go of it, so a swipe
  // that starts on the chart still scrolls Home.
  const scrub = Gesture.Pan()
    .maxPointers(1)
    .activeOffsetX([-4, 4])
    .failOffsetY([-10, 10])
    .onBegin((e) => scrubAt(e.x))
    .onUpdate((e) => scrubAt(e.x))
    .onFinalize(() => setScrubDay(null))
    .runOnJS(true)

  // Headed like the cards round it: its mark, tinted with where the month stands, then its title.
  const labelRow = (
    <View className="flex-row items-center gap-2">
      <TileIcon name="stats-chart" color={hasHistory ? gapColor : colors.primary} />
      <Text className="shrink font-sansSemi text-base text-textPrimary" numberOfLines={1}>
        Spending
      </Text>
    </View>
  )

  if (!hasHistory) {
    return (
      <Card grow style={CARD}>
        {labelRow}
        <View className="flex-1 justify-center">
          <Text className="font-sans text-sm text-textPrimary">
            Nothing from {monthName(previousMonth, 'long')} to compare with yet.
          </Text>
        </View>
      </Card>
    )
  }

  const reading = describe(readGap)

  return (
    <Card grow style={CARD}>
      {labelRow}

      {/* The figure: the gap as the tile's one big number, an arrow and its side's colour saying which
          way, and "vs Oct" after it. Touching the chart reads that day into it, the day taking the
          place of "vs Oct" so nothing below shifts. */}
      <View className="flex-row items-center gap-1">
        {reading.amount ? <Ionicons name={readGap > 0 ? 'arrow-up' : 'arrow-down'} size={18} color={reading.color} /> : null}
        <Text
          className="font-display text-lg"
          style={[TABULAR, { color: reading.amount ? reading.color : colors.textPrimary }]}
          numberOfLines={1}
        >
          {reading.amount ?? 'Level'}
        </Text>
        {/* What the figure is measured against, right after it; while touching, the day instead. */}
        <Text className="ml-1 shrink font-sansMed text-xs text-textPrimary" style={TABULAR} numberOfLines={1}>
          {scrubDay != null ? `${monthName(month, 'short')} ${readDay}` : `vs ${monthName(previousMonth, 'short')}`}
        </Text>
      </View>

      <View className="flex-1 justify-end">
        <GestureDetector gesture={scrub}>
          <View onLayout={(e) => setWidth(e.nativeEvent.layout.width)} style={{ height: CHART_HEIGHT }}>
          {/* Drawn in the trend charts' own language (TrendLine): a thin line in its direction's
              colour, a fill that fades away from it, a pulsing dot at today, and the same ringed
              marker under a finger. */}
          {width > 0 ? (
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
                  <Path
                    d={gapLine}
                    stroke={gapColor}
                    strokeWidth={1.5}
                    strokeLinejoin="round"
                    strokeLinecap="round"
                    fill="none"
                  />
                </>
              ) : null}

              {scrubDay != null ? (
                <>
                  <Line
                    x1={x(readDay)}
                    x2={x(readDay)}
                    y1={0}
                    y2={CHART_HEIGHT}
                    stroke={colors.textSecondary}
                    strokeWidth={1}
                    opacity={0.7}
                  />
                  <ScrubMarker x={x(readDay)} y={yGap(readGap)} color={gapColor} />
                </>
              ) : (
                <LiveDot x={x(throughDay)} y={yGap(gaps[throughDay]?.gap ?? 0)} color={gapColor} />
              )}
            </Svg>
          ) : null}
          </View>
        </GestureDetector>
      </View>
    </Card>
  )
}
