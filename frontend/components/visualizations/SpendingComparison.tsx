import { useMemo, useState, type ComponentProps } from 'react'
import { Pressable, Text, View } from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import { useMMKVString } from 'react-native-mmkv'
import Svg, { Circle, ClipPath, Defs, Line, Path, Rect, Text as SvgText } from 'react-native-svg'
import { colors, fontFamily, hexToRgba } from '@/constants/theme'
import { formatMaskableAmount } from '@/lib/format/money'
import { useAmountsMasked } from '@/hooks/useAmountsMasked'
import { monotoneLine } from '@/lib/charts/lineChart'
import { totalThrough, type MonthComparison } from '@/lib/budgets/monthComparison'
import { shiftMonth, type YearMonth } from '@/lib/transactions/filterByMonth'
import { SPENDING_CHART_VIEW_KEY, preferences } from '@/lib/storage/preferences'

const CHART_HEIGHT = 96
/** How much of each half the gap line may use, so its peak and the end dot clear the edges. */
const HEADROOM = 0.82
/**
 * A column on the right for the gap view's labels — "more" over last month's name over "less" —
 * clear of the plot, so the line can never run into them.
 */
const LABEL_GUTTER = 64
/** The totals view has no labels: just room past the line's last day for its end dot. */
const PLOT_RIGHT = 6
/**
 * The smallest gap that fills the chart, as a share of last month's whole spending. Without it the
 * scale fits whatever the gap is, and a month's first purchase always shoots to the edge.
 */
const MIN_REACH_SHARE = 0.2
/** Under a cent either way is level: the totals are sums of cents, and float drift isn't news. */
const LEVEL = 0.005

type ChartView = 'gap' | 'total'

const VIEW_OPTIONS: Array<{ value: ChartView; icon: ComponentProps<typeof Ionicons>['name']; label: string }> = [
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
 * This month's spending against last month's, two ways, switched by the small icons in its header
 * row (and remembered on the device):
 *
 * - Gap: last month is the dashed line across the middle, and the line is how far ahead of it
 *   (above, red) or behind it (below, green) this month's running total was on each day. A running
 *   total plateaus whenever nothing is spent; the gap doesn't.
 * - Totals: both months' running totals, smoothed — this month solid, last month dashed.
 *
 * No figures at rest beyond one sentence for where the month stands; touching the chart reads that
 * day into the same row.
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

  const plotWidth = Math.max(0, width - (view === 'gap' ? LABEL_GUTTER : PLOT_RIGHT))
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
  const yTotal = (total: number) => base - (total / top) * (CHART_HEIGHT - 10)
  const totalPoints = (points: MonthComparison['current'], lastDay: number) =>
    Array.from({ length: lastDay + 1 }, (_, day) => ({ x: x(day), y: yTotal(totalThrough(points, day)) }))
  const currentLine = monotoneLine(totalPoints(current, throughDay))
  const previousLine = monotoneLine(totalPoints(previous, previousDays))
  const currentArea = currentLine ? `${currentLine} L ${x(throughDay)} ${base} L 0 ${base} Z` : ''

  const readDay = scrubDay != null ? Math.min(scrubDay, throughDay) : throughDay
  const readPreviousDay = Math.min(readDay, previousDays)
  const readGap = gaps[readDay]?.gap ?? 0
  const prevName = monthName(previousMonth, 'long')

  /** The gap as words: "$84 more than", "$20 less than", or "level with". */
  function describe(gap: number): { lead: string; color: string } {
    if (Math.abs(gap) < LEVEL) return { lead: 'level with', color: colors.textSecondary }
    const amount = formatMaskableAmount(Math.abs(gap), isMasked)
    return gap > 0 ? { lead: `${amount} more than`, color: colors.expense } : { lead: `${amount} less than`, color: colors.income }
  }

  function scrubAt(locationX: number) {
    if (plotWidth <= 0 || throughDay === 0) return
    setScrubDay(Math.min(throughDay, Math.max(1, Math.round((locationX / plotWidth) * daysInMonth))))
  }

  // Styled like Home's Budget row — badge, title — so the two sections read as a pair. Not a link:
  // the only control in it is the switch between the two views.
  const labelRow = (
    <View className="flex-row items-center gap-3">
      <View className="h-8 w-8 items-center justify-center rounded-full" style={{ backgroundColor: colors.primaryMuted }}>
        <Ionicons name="stats-chart" size={14} color={colors.primary} />
      </View>
      <Text className="flex-1 font-sansSemi text-base text-textPrimary" numberOfLines={1}>
        Spending
      </Text>
      {hasHistory ? (
        <View className="flex-row rounded-full" style={{ backgroundColor: colors.surfaceRaised, padding: 2 }}>
          {VIEW_OPTIONS.map((option) => {
            const selected = option.value === view
            return (
              <Pressable
                key={option.value}
                onPress={() => setStoredView(option.value)}
                accessibilityRole="button"
                accessibilityLabel={option.label}
                accessibilityState={{ selected }}
                hitSlop={4}
                className="rounded-full px-2 py-0.5"
                style={selected ? { backgroundColor: colors.surface } : undefined}
              >
                <Ionicons name={option.icon} size={14} color={selected ? colors.primary : colors.textMuted} />
              </Pressable>
            )
          })}
        </View>
      ) : null}
    </View>
  )

  if (!hasHistory) {
    return (
      <View className="gap-2">
        {labelRow}
        <Text className="font-sans text-sm text-textMuted">Nothing from {prevName} to compare with yet.</Text>
      </View>
    )
  }

  const reading = describe(readGap)

  return (
    <View className="gap-2">
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
        {width > 0 && view === 'gap' ? (
          <Svg width={width} height={CHART_HEIGHT}>
            <Defs>
              <ClipPath id="gap-above">
                <Rect x={0} y={0} width={width} height={mid} />
              </ClipPath>
              <ClipPath id="gap-below">
                <Rect x={0} y={mid} width={width} height={mid} />
              </ClipPath>
            </Defs>

            {/* Last month: the line this one is measured from, named at its end. */}
            <Line x1={0} x2={plotWidth} y1={mid} y2={mid} stroke={colors.borderStrong} strokeWidth={1} strokeDasharray="4 4" />
            <SvgText x={width} y={mid + 4} textAnchor="end" fontFamily={fontFamily.sans} fontSize={11} fill={colors.textMuted}>
              {prevName}
            </SvgText>
            <SvgText x={width} y={12} textAnchor="end" fontFamily={fontFamily.sans} fontSize={11} fill={colors.expense}>
              more
            </SvgText>
            <SvgText x={width} y={CHART_HEIGHT - 4} textAnchor="end" fontFamily={fontFamily.sans} fontSize={11} fill={colors.income}>
              less
            </SvgText>

            {gapArea ? (
              <>
                <Path d={gapArea} fill={hexToRgba(colors.expense, 0.12)} clipPath="url(#gap-above)" />
                <Path d={gapArea} fill={hexToRgba(colors.income, 0.16)} clipPath="url(#gap-below)" />
                <Path d={gapLine} stroke={colors.textPrimary} strokeWidth={2} strokeLinejoin="round" fill="none" />
              </>
            ) : null}

            {scrubDay != null ? <Line x1={x(readDay)} x2={x(readDay)} y1={0} y2={CHART_HEIGHT} stroke={colors.textSecondary} strokeWidth={1} /> : null}
            <Circle cx={x(readDay)} cy={yGap(readGap)} r={4} fill={colors.textPrimary} stroke={colors.surface} strokeWidth={2} />
          </Svg>
        ) : null}

        {width > 0 && view === 'total' ? (
          <Svg width={width} height={CHART_HEIGHT}>
            <Line x1={0} x2={plotWidth} y1={base} y2={base} stroke={colors.border} strokeWidth={1} />
            {previousLine ? <Path d={previousLine} stroke={colors.textMuted} strokeWidth={1.5} strokeDasharray="4 4" fill="none" /> : null}
            {currentLine ? (
              <>
                <Path d={currentArea} fill={hexToRgba(colors.expense, 0.08)} />
                <Path d={currentLine} stroke={colors.expense} strokeWidth={2} strokeLinejoin="round" fill="none" />
              </>
            ) : null}

            {scrubDay != null ? (
              <>
                <Line x1={x(readDay)} x2={x(readDay)} y1={0} y2={base} stroke={colors.textSecondary} strokeWidth={1} />
                <Circle cx={x(readPreviousDay)} cy={yTotal(totalThrough(previous, readPreviousDay))} r={3} fill={colors.surface} stroke={colors.textMuted} strokeWidth={1.5} />
              </>
            ) : null}
            <Circle cx={x(readDay)} cy={yTotal(totalThrough(current, readDay))} r={4} fill={colors.expense} stroke={colors.surface} strokeWidth={2} />
          </Svg>
        ) : null}
      </View>

      {/* Where the month stands — or, while touching, where it stood on that day. */}
      <Text className="font-sans text-xs text-textSecondary" numberOfLines={1}>
        {scrubDay != null && view === 'total' ? (
          <>
            {monthName(month, 'short')} {readDay}{' '}
            <Text className="font-sansSemi" style={{ color: colors.expense }}>
              {formatMaskableAmount(totalThrough(current, readDay), isMasked)}
            </Text>
            {'  ·  '}
            {monthName(previousMonth, 'short')} {readPreviousDay}{' '}
            <Text className="font-sansSemi text-textSecondary">{formatMaskableAmount(totalThrough(previous, readPreviousDay), isMasked)}</Text>
          </>
        ) : scrubDay != null ? (
          <>
            {monthName(month, 'short')} {readDay} ·{' '}
            <Text className="font-sansSemi" style={{ color: reading.color }}>
              {reading.lead}
            </Text>{' '}
            {monthName(previousMonth, 'short')} {readPreviousDay}
          </>
        ) : isCurrentMonth ? (
          <>
            <Text className="font-sansSemi" style={{ color: reading.color }}>
              {reading.lead}
            </Text>{' '}
            {prevName}
            {throughDay > 0 ? ` by ${monthName(month, 'short')} ${throughDay}` : ''}
          </>
        ) : (
          <>
            Ended{' '}
            <Text className="font-sansSemi" style={{ color: reading.color }}>
              {reading.lead}
            </Text>{' '}
            {prevName}
          </>
        )}
      </Text>
    </View>
  )
}
