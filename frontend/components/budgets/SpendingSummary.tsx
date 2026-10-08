import { useState } from 'react'
import { Text, View } from 'react-native'
import Svg, { Circle, Line, Path, Text as SvgText } from 'react-native-svg'
import { Ionicons } from '@expo/vector-icons'
import { borderRadius, colors, fontFamily, fontSize, hexToRgba, shadow } from '@/constants/theme'
import { formatAmount } from '@/lib/format/money'
import type { CumulativePoint, MonthComparison } from '@/lib/budgets/monthComparison'
import { shiftMonth, type YearMonth } from '@/lib/transactions/filterByMonth'
import { Eyebrow } from './Eyebrow'

const CHART_HEIGHT = 112
// Room above the highest point for the end-of-month label.
const CHART_PAD_TOP = 20

function monthName(month: YearMonth, style: 'long' | 'short'): string {
  return new Date(month.year, month.month - 1, 1).toLocaleDateString('en-US', { month: style })
}

interface SpendingSummaryProps {
  month: YearMonth
  comparison: MonthComparison
  isCurrentMonth: boolean
}

/**
 * How this month's spending compares with last month's: the total, the change against last month
 * at the same point, and both months drawn as running totals so it shows where they pulled apart.
 * Every category counts here, budgeted or not — the ring above answers "am I inside my budgets",
 * this answers "am I spending more than last month".
 */
export function SpendingSummary({ month, comparison, isCurrentMonth }: SpendingSummaryProps) {
  const [chartWidth, setChartWidth] = useState(0)
  const previousMonth = shiftMonth(month, -1)
  const { current, previous, currentTotal, previousAtSameDay, change } = comparison

  const lastDay = Math.max(new Date(month.year, month.month, 0).getDate(), previous.at(-1)?.day ?? 0)
  const peak = Math.max(currentTotal, previous.at(-1)?.total ?? 0, 1)
  const x = (day: number) => (day / lastDay) * chartWidth
  const y = (total: number) => CHART_PAD_TOP + (1 - total / peak) * (CHART_HEIGHT - CHART_PAD_TOP)

  // Both lines start from nothing spent before the 1st.
  const toPath = (points: CumulativePoint[]) =>
    [{ day: 0, total: 0 }, ...points].map((p, i) => `${i === 0 ? 'M' : 'L'}${x(p.day).toFixed(1)},${y(p.total).toFixed(1)}`).join(' ')
  const currentEnd = current.at(-1)

  const isUp = change != null && change > 0
  const isFlat = change != null && Math.round(change * 100) === 0
  const changeColor = change == null || isFlat ? colors.textMuted : isUp ? colors.expense : colors.income
  const previousEnd = previous.at(-1)
  const comparedTo = isCurrentMonth ? `this point in ${monthName(previousMonth, 'long')}` : monthName(previousMonth, 'long')

  return (
    <View style={[shadow.sm, { borderRadius: borderRadius.xl, backgroundColor: colors.surface }]}>
      <View className="gap-3 rounded-xl bg-surface p-4">
        <View className="flex-row items-baseline justify-between">
          <Eyebrow>Spending</Eyebrow>
          <Text className="font-sans text-xs text-textMuted">All categories</Text>
        </View>

        <View className="gap-1">
          <Text className="font-display text-xl text-textPrimary">{formatAmount(currentTotal)}</Text>
          {isFlat ? (
            <Text className="font-sans text-sm text-textSecondary">Same as {comparedTo}</Text>
          ) : change != null ? (
            <View className="flex-row items-center gap-1">
              <Ionicons name={isUp ? 'caret-up' : 'caret-down'} size={12} color={changeColor} />
              <Text className="font-sansSemi text-sm" style={{ color: changeColor }}>
                {Math.round(Math.abs(change) * 100)}%
              </Text>
              <Text className="font-sans text-sm text-textSecondary">
                vs {comparedTo} · <Text className="font-mono">{formatAmount(previousAtSameDay)}</Text>
              </Text>
            </View>
          ) : (
            <Text className="font-sans text-sm text-textMuted">Nothing spent in {comparedTo} to compare</Text>
          )}
        </View>

        <View onLayout={(e) => setChartWidth(e.nativeEvent.layout.width)} style={{ height: CHART_HEIGHT }}>
          {chartWidth > 0 ? (
            <Svg width={chartWidth} height={CHART_HEIGHT}>
              <Line x1={0} y1={CHART_HEIGHT - 0.5} x2={chartWidth} y2={CHART_HEIGHT - 0.5} stroke={colors.border} strokeWidth={1} />
              {previous.length > 0 ? (
                <Path d={toPath(previous)} stroke={colors.textMuted} strokeWidth={2} strokeDasharray="4 4" fill="none" />
              ) : null}
              {/* Where last month ended, so the gap between the lines has a scale. */}
              {previousEnd && previousEnd.total > 0 ? (
                <SvgText
                  x={x(previousEnd.day)}
                  y={y(previousEnd.total) - 6}
                  textAnchor="end"
                  fontFamily={fontFamily.mono}
                  fontSize={fontSize.xs}
                  fill={colors.textMuted}
                >
                  {formatAmount(previousEnd.total)}
                </SvgText>
              ) : null}
              {currentEnd ? (
                <>
                  <Path
                    d={`${toPath(current)} L${x(currentEnd.day).toFixed(1)},${CHART_HEIGHT} L0,${CHART_HEIGHT} Z`}
                    fill={hexToRgba(colors.primary, 0.08)}
                  />
                  <Path d={toPath(current)} stroke={colors.primary} strokeWidth={2.5} strokeLinejoin="round" fill="none" />
                  <Circle cx={x(currentEnd.day)} cy={y(currentEnd.total)} r={4.5} fill={colors.primary} stroke={colors.surface} strokeWidth={2} />
                </>
              ) : null}
            </Svg>
          ) : null}
        </View>

        <View className="flex-row items-center justify-between">
          <View className="flex-row items-center gap-4">
            <View className="flex-row items-center gap-1.5">
              <View className="h-0.5 w-4 rounded-full bg-primary" />
              <Text className="font-sans text-xs text-textSecondary">{monthName(month, 'long')}</Text>
            </View>
            <View className="flex-row items-center gap-1.5">
              <View className="flex-row gap-0.5">
                <View className="h-0.5 w-1.5 rounded-full" style={{ backgroundColor: colors.textMuted }} />
                <View className="h-0.5 w-1.5 rounded-full" style={{ backgroundColor: colors.textMuted }} />
              </View>
              <Text className="font-sans text-xs text-textSecondary">{monthName(previousMonth, 'long')}</Text>
            </View>
          </View>
          <Text className="font-mono text-xs text-textMuted">
            {monthName(month, 'short')} 1–{lastDay}
          </Text>
        </View>
      </View>
    </View>
  )
}
