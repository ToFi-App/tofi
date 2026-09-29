import { memo } from 'react'
import { Pressable, Text, View } from 'react-native'
import { colors, hexToRgba } from '@/constants/theme'
import { AccountGlyph } from '@/components/accounts/AccountGlyph'
import { GROUP_COLORS, fallbackIconFor, seriesColor } from '@/components/accounts/netWorthPalette'
import { formatAmount } from '@/lib/format/money'
import type { TrendPoint } from '@/lib/accounts/netWorthHistory'
import type { NetWorthSeries, NetWorthSeriesGroup } from '@/lib/accounts/netWorthSeries'

const GROUP_LABELS: Record<NetWorthSeriesGroup, string> = {
  investment: 'Investments',
  cash: 'Cash',
  liability: 'Debt',
}

/** Balances are signed as net worth counts them, so "up" is good for every account — debt included. */
function changeColor(change: number): string {
  if (change > 0) return colors.income
  if (change < 0) return colors.expense
  return colors.textMuted
}

function formatChange(change: number): string {
  return `${change > 0 ? '+' : ''}${formatAmount(change)}`
}

interface NetWorthAccountRowsProps {
  /** One point per day, week or month; only each point's balances are read. */
  months: Pick<TrendPoint, 'balances'>[]
  series: NetWorthSeries[]
  /** Balances as the period opened (periodStart) — the baseline every change is measured from. */
  start: Map<string, number>
  /** The month the values describe: the selected one, or the latest. */
  index: number
  /** The highlighted account — from a tapped tile or a tapped row; its row is tinted. */
  highlightedKey?: string | null
  /** Tapping a row highlights its account everywhere; tapping it again clears. */
  onHighlight?: (key: string | null) => void
}

/**
 * The accounts behind the bars, one full-width row each: its segment's colour swatch (the chart's
 * legend), logo, name, and its balance and change
 * for the month being read. Grouped top to bottom the way the bar reads: investments on top,
 * cash on the zero line, debt below it.
 *
 * An account that is zero for the entire period is left out — it draws no segment anywhere, so a
 * row would be a legend entry for nothing.
 */
export const NetWorthAccountRows = memo(function NetWorthAccountRows({ months, series, start, index, highlightedKey, onHighlight }: NetWorthAccountRowsProps) {
  const month = months[index]
  if (!month) return null

  const groups = (['investment', 'cash', 'liability'] as const)
    .map((group) => ({
      group,
      rows: series.filter(
        (s) => s.group === group && months.some((m) => (m.balances.get(s.key) ?? 0) !== 0),
      ),
    }))
    .filter(({ rows }) => rows.length > 0)

  return (
    <View>
      {groups.map(({ group, rows }) => {
        const total = rows.reduce((sum, s) => sum + (month.balances.get(s.key) ?? 0), 0)
        return (
          <View key={group} className="pt-5">
            <View className="flex-row items-baseline justify-between px-5 pb-1">
              <Text className="font-sansSemi text-md" style={{ color: GROUP_COLORS[group].text }}>
                {GROUP_LABELS[group]}
              </Text>
              <Text className="font-sansSemi text-base" style={{ color: GROUP_COLORS[group].text }}>
                {formatAmount(total)}
              </Text>
            </View>
            {rows.map((s, rowIndex) => {
              const value = month.balances.get(s.key) ?? 0
              const opening = start.get(s.key) ?? 0
              const change = Math.round((value - opening) * 100) / 100
              return (
                <Pressable
                  key={s.key}
                  onPress={() => onHighlight?.(s.key === highlightedKey ? null : s.key)}
                  accessibilityRole="button"
                  accessibilityState={{ selected: s.key === highlightedKey }}
                  className="flex-row items-center gap-3 py-4"
                  style={[
                    { marginHorizontal: 20 },
                    rowIndex > 0 ? { borderTopWidth: 1, borderColor: colors.border } : null,
                    // Tinted and widened by 8px each side, with the same 8px padded back in, so
                    // the highlight gets a margin around its content without moving it.
                    s.key === highlightedKey
                      ? { marginHorizontal: 12, paddingHorizontal: 8, borderRadius: 12, backgroundColor: hexToRgba(colors.primary, 0.1) }
                      : null,
                  ]}
                >
                  {/* The legend: the exact fill this account's segment is drawn in. */}
                  <View style={{ width: 10, height: 10, borderRadius: 3, backgroundColor: seriesColor(s) }} />
                  <AccountGlyph logo={s.logo} icon={fallbackIconFor(s.group, s.key, s.itemId)} size={32} />
                  {/* The name is the only elastic part: it ellipsizes so the figures always keep
                      their width. */}
                  <Text className="flex-1 font-sansMed text-base text-textPrimary" numberOfLines={1}>
                    {s.label}
                  </Text>
                  <View className="items-end">
                    <Text className="font-sansSemi text-base text-textPrimary" numberOfLines={1}>
                      {formatAmount(value)}
                    </Text>
                    <Text className="font-sans text-xs" style={{ color: changeColor(change) }} numberOfLines={1}>
                      {formatChange(change)}
                    </Text>
                  </View>
                </Pressable>
              )
            })}
          </View>
        )
      })}
    </View>
  )
})
