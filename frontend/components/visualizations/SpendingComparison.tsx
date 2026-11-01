import { useState } from 'react'
import { Text, View } from 'react-native'
import Svg, { Circle, Line, Path, Text as SvgText } from 'react-native-svg'
import { Ionicons } from '@expo/vector-icons'
import { colors, fontFamily, hexToRgba } from '@/constants/theme'
import { formatAmount } from '@/lib/format/money'
import { comparisonStats, totalThrough, type CumulativePoint, type MonthComparison } from '@/lib/budgets/monthComparison'
import { shiftMonth, type YearMonth } from '@/lib/transactions/filterByMonth'

const CHART_HEIGHT = 180
const PLOT_TOP = 8
/** Room under the plot for the day labels. */
const PLOT_BOTTOM = 18
/** Room on the right for the amount labels on the gridlines. */
const AXIS_WIDTH = 44
const GRIDLINES = 3

function monthName(month: YearMonth, style: 'long' | 'short'): string {
  return new Date(month.year, month.month - 1, 1).toLocaleDateString('en-US', { month: style })
}

/** Gridline labels: whole dollars, thousands as k, so every label reads the same way. */
function axisLabel(value: number): string {
  return value >= 1000 ? `$${(value / 1000).toLocaleString('en-US', { maximumFractionDigits: 1 })}k` : `$${value}`
}

/** A round step for the gridlines: 1, 2 or 5 times a power of ten, enough for GRIDLINES to cover the peak. */
function niceStep(peak: number): number {
  const raw = peak / GRIDLINES
  const magnitude = 10 ** Math.floor(Math.log10(Math.max(raw, 1)))
  return [1, 2, 5, 10].map((m) => m * magnitude).find((s) => s >= raw) ?? magnitude * 10
}

interface SpendingComparisonProps {
  month: YearMonth
  comparison: MonthComparison
  isCurrentMonth: boolean
}

/**
 * This month's spending against last month's, as both months' running totals — the solid line this
 * month, dashed last — so it shows where they pulled apart. Touching the chart reads both lines on
 * that day; at rest the reading is the latest day. While the month is under way a dotted line
 * carries its pace to the end.
 */
export function SpendingComparison({ month, comparison, isCurrentMonth }: SpendingComparisonProps) {
  const [width, setWidth] = useState(0)
  const [scrubDay, setScrubDay] = useState<number | null>(null)
  const previousMonth = shiftMonth(month, -1)
  const { current, previous, currentTotal, change } = comparison
  const daysInMonth = new Date(month.year, month.month, 0).getDate()
  const stats = comparisonStats(comparison, daysInMonth, isCurrentMonth)
  const lastDay = Math.max(daysInMonth, previous.at(-1)?.day ?? 0)
  const throughDay = current.at(-1)?.day ?? 0

  const plotWidth = Math.max(0, width - AXIS_WIDTH)
  const plotHeight = CHART_HEIGHT - PLOT_TOP - PLOT_BOTTOM
  const peak = Math.max(currentTotal, stats.previousTotal, stats.projected ?? 0, 1)
  const step = niceStep(peak)
  const top = step * Math.ceil(peak / step)
  const x = (day: number) => (day / lastDay) * plotWidth
  const y = (total: number) => PLOT_TOP + (1 - total / top) * plotHeight
  const toPath = (points: CumulativePoint[]) =>
    [{ day: 0, total: 0 }, ...points].map((p, i) => `${i === 0 ? 'M' : 'L'}${x(p.day).toFixed(1)},${y(p.total).toFixed(1)}`).join(' ')

  const readDay = scrubDay ?? throughDay
  const readCurrent = readDay <= throughDay ? totalThrough(current, readDay) : null
  // Last month may be shorter: the 31st reads its last day, which is where its line ends too.
  const previousDays = new Date(previousMonth.year, previousMonth.month, 0).getDate()
  const readPreviousDay = Math.min(readDay, previousDays)
  const readPrevious = previous.length > 0 ? totalThrough(previous, readPreviousDay) : null

  const isUp = change != null && change > 0
  const isFlat = change != null && Math.round(change * 100) === 0
  const changeColor = change == null || isFlat ? colors.textSecondary : isUp ? colors.expense : colors.income

  function scrubAt(locationX: number) {
    if (plotWidth <= 0) return
    setScrubDay(Math.min(lastDay, Math.max(1, Math.round((locationX / plotWidth) * lastDay))))
  }

  return (
    <View className="gap-4">
      <View className="flex-row items-center justify-between">
        <Text className="font-sansSemi text-base">
          <Text style={{ color: colors.primary }}>{monthName(month, 'long')}</Text>
          <Text className="text-textSecondary"> vs {monthName(previousMonth, 'long')}</Text>
        </Text>
        {change != null ? (
          <View className="flex-row items-center gap-0.5 rounded-full px-2 py-0.5" style={{ backgroundColor: hexToRgba(changeColor, 0.12) }}>
            {isFlat ? null : <Ionicons name={isUp ? 'caret-up' : 'caret-down'} size={11} color={changeColor} />}
            <Text className="font-sansSemi text-xs" style={{ color: changeColor }}>
              {isFlat ? 'Same' : `${Math.round(Math.abs(change) * 100)}%`}
            </Text>
          </View>
        ) : null}
      </View>

      {/* The reading: both months' running totals on one day — the touched one, or the latest. */}
      <View className="flex-row items-end gap-6">
        <View className="gap-0.5">
          <Text className="font-sansMed text-sm text-textSecondary">
            {monthName(month, 'short')} {readDay}
          </Text>
          <Text className="font-display text-xl" style={{ color: colors.primary }}>
            {readCurrent != null ? formatAmount(readCurrent) : '—'}
          </Text>
        </View>
        <View className="gap-0.5">
          <Text className="font-sansMed text-sm text-textSecondary">
            {monthName(previousMonth, 'short')} {readPreviousDay}
          </Text>
          <Text className="font-display text-xl text-textSecondary">{readPrevious != null ? formatAmount(readPrevious) : '—'}</Text>
        </View>
      </View>

      <View
        onLayout={(e) => setWidth(e.nativeEvent.layout.width)}
        style={{ height: CHART_HEIGHT }}
        // The responder rather than a gesture handler: a touch reads a day and a drag scrubs, and once
        // the chart holds the touch the pager behind it doesn't take it back mid-drag.
        onStartShouldSetResponder={() => true}
        onMoveShouldSetResponder={() => true}
        onResponderTerminationRequest={() => false}
        onResponderGrant={(e) => scrubAt(e.nativeEvent.locationX)}
        onResponderMove={(e) => scrubAt(e.nativeEvent.locationX)}
        onResponderRelease={() => setScrubDay(null)}
      >
        {width > 0 ? (
          <Svg width={width} height={CHART_HEIGHT}>
            {Array.from({ length: Math.round(top / step) + 1 }, (_, i) => i * step).map((value) => (
              <Line
                key={`grid-${value}`}
                x1={0}
                x2={plotWidth}
                y1={y(value)}
                y2={y(value)}
                stroke={value === 0 ? colors.borderStrong : colors.border}
                strokeWidth={1}
              />
            ))}
            {Array.from({ length: Math.round(top / step) + 1 }, (_, i) => i * step).map((value) => (
              <SvgText key={`label-${value}`} x={width} y={y(value) + 4} textAnchor="end" fontFamily={fontFamily.mono} fontSize={11} fill={colors.textSecondary}>
                {axisLabel(value)}
              </SvgText>
            ))}
            {[1, 8, 15, 22, lastDay].map((day) => (
              <SvgText key={`day-${day}`} x={x(day)} y={CHART_HEIGHT - 3} textAnchor={day === lastDay ? 'end' : 'middle'} fontFamily={fontFamily.mono} fontSize={11} fill={colors.textSecondary}>
                {day}
              </SvgText>
            ))}

            {previous.length > 0 ? <Path d={toPath(previous)} stroke={colors.borderStrong} strokeWidth={2} strokeDasharray="4 4" fill="none" /> : null}
            {current.length > 0 ? (
              <>
                <Path d={`${toPath(current)} L${x(throughDay).toFixed(1)},${y(0)} L0,${y(0)} Z`} fill={hexToRgba(colors.primary, 0.08)} />
                <Path d={toPath(current)} stroke={colors.primary} strokeWidth={2.5} strokeLinejoin="round" fill="none" />
              </>
            ) : null}
            {stats.projected != null ? (
              <Line
                x1={x(throughDay)}
                y1={y(currentTotal)}
                x2={x(daysInMonth)}
                y2={y(stats.projected)}
                stroke={colors.primary}
                strokeOpacity={0.5}
                strokeWidth={2}
                strokeDasharray="1 5"
                strokeLinecap="round"
              />
            ) : null}

            {/* The read day: a rule down the chart and a dot on each line. */}
            <Line x1={x(readDay)} x2={x(readDay)} y1={PLOT_TOP} y2={y(0)} stroke={scrubDay != null ? colors.textSecondary : 'transparent'} strokeWidth={1} />
            {readPrevious != null ? <Circle cx={x(readPreviousDay)} cy={y(readPrevious)} r={3.5} fill={colors.surface} stroke={colors.textSecondary} strokeWidth={1.5} /> : null}
            {readCurrent != null ? <Circle cx={x(readDay)} cy={y(readCurrent)} r={4.5} fill={colors.primary} stroke={colors.surface} strokeWidth={2} /> : null}
          </Svg>
        ) : null}
      </View>
    </View>
  )
}
