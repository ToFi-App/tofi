import { Pressable, ScrollView, Text, View } from 'react-native'
import { colors, hexToRgba } from '@/constants/theme'
import {
  assetClass,
  averageCost,
  formatGainPct,
  formatShares,
  holdingGain,
  holdingGainPct,
  holdingLabel,
  monogramText,
  performanceColor,
  sortHoldingsByValue,
} from '@/lib/accounts/holdings'
import { formatCompactMaskableAmount, formatMaskableAmount } from '@/lib/format/money'
import type { Holding } from '@/types/domain'

/** Pinned height for the scrolling name line (text-sm). */
const NAME_LINE_HEIGHT = 18

interface HoldingRowsProps {
  holdings: Holding[]
  isMasked: boolean
  /** The highlighted holding — from a tapped tile or a tapped row. Its row is tinted and opens. */
  selectedId: string | null
  onSelect: (securityId: string | null) => void
}

/**
 * The holdings behind the map, one row each: monogram, symbol and name, value, and gain.
 * Grouped under coloured asset-class headers — the same colours the tiles use, which is what
 * lets the map drop its legend.
 *
 * Shares and price are one tap away rather than on every row. A tapped row (or its tile) opens a
 * detail line with them, so nothing the old table showed is lost; it just stops competing with
 * the two figures most rows are read for.
 */
export function HoldingRows({ holdings, isMasked, selectedId, onSelect }: HoldingRowsProps) {
  const groups = new Map<string, { cls: ReturnType<typeof assetClass>; rows: Holding[]; total: number }>()
  for (const holding of sortHoldingsByValue(holdings)) {
    const cls = assetClass(holding.type)
    const group = groups.get(cls.key) ?? { cls, rows: [], total: 0 }
    group.rows.push(holding)
    group.total += holding.institutionValue ?? 0
    groups.set(cls.key, group)
  }
  // Largest class first, matching the map, where the biggest class holds the biggest area.
  const ordered = [...groups.values()].sort((a, b) => b.total - a.total)

  return (
    <View>
      {ordered.map(({ cls, rows, total }) => (
        <View key={cls.key} className="pt-5">
          <View className="flex-row items-baseline justify-between pb-1">
            <Text className="font-sansSemi text-md" style={{ color: cls.textColor }}>
              {cls.label}
            </Text>
            <Text className="font-sansSemi text-base" style={{ color: cls.textColor }}>
              {formatMaskableAmount(total, isMasked)}
            </Text>
          </View>
          {rows.map((holding, rowIndex) => (
            <HoldingRow
              key={holding.securityId}
              holding={holding}
              isMasked={isMasked}
              isFirst={rowIndex === 0}
              isSelected={holding.securityId === selectedId}
              onPress={() => onSelect(holding.securityId === selectedId ? null : holding.securityId)}
            />
          ))}
        </View>
      ))}
    </View>
  )
}

function HoldingRow({
  holding,
  isMasked,
  isFirst,
  isSelected,
  onPress,
}: {
  holding: Holding
  isMasked: boolean
  isFirst: boolean
  isSelected: boolean
  onPress: () => void
}) {
  const label = holdingLabel(holding)
  const cls = assetClass(holding.type)
  const gain = holdingGain(holding)
  const gainPct = holdingGainPct(holding)
  const avg = averageCost(holding)
  // GAIN% is unmasked on purpose — a ratio discloses no balance, and privacy mode is most
  // useful when it still answers "how is this doing".
  const gainText =
    gain != null
      ? `${gain > 0 ? '+' : ''}${formatCompactMaskableAmount(gain, isMasked)} (${formatGainPct(gainPct)})`
      : 'No cost basis'
  const details: Array<{ label: string; value: string }> = [
    { label: 'Shares', value: formatShares(holding.quantity) },
    ...(holding.institutionPrice != null
      ? [{ label: 'Price', value: formatCompactMaskableAmount(holding.institutionPrice, isMasked) }]
      : []),
    ...(avg != null ? [{ label: 'Average Cost', value: formatCompactMaskableAmount(avg, isMasked) }] : []),
  ]

  // Tapping anywhere on the row selects it, but the row is NOT one big Pressable: the name's
  // horizontal ScrollView must not sit inside a touchable, or the touchable claims the drag and the
  // name never scrolls. So each part is its own Pressable, and the name's sits INSIDE its scroller —
  // the standard nesting, where a tap presses and a drag scrolls. Each carries the row's vertical
  // padding as hitSlop, so the padding still reads as part of the row.
  const press = {
    onPress,
    hitSlop: { top: 16, bottom: 16 },
    accessibilityRole: 'button' as const,
    accessibilityState: { selected: isSelected },
  }

  return (
    <View
      className="py-4"
      style={[
        !isFirst ? { borderTopWidth: 1, borderColor: colors.border } : null,
        // Widened by 12px each side with the same 12px padded back in, so the highlight gets a
        // margin around its content without moving it.
        isSelected
          ? { marginHorizontal: -12, paddingHorizontal: 12, borderRadius: 14, backgroundColor: hexToRgba(colors.primary, 0.1) }
          : null,
      ]}
    >
      <View className="flex-row items-center gap-4">
        {/* Plaid ships no security logos, so a stable monogram in the tile's own colour stands in. */}
        <Pressable {...press}>
          <View
            className="h-8 w-8 items-center justify-center rounded-full"
            style={{ backgroundColor: hexToRgba(cls.color, 0.18) }}
          >
            <Text className="font-sansSemi text-xs" style={{ color: cls.color }}>
              {monogramText(label)}
            </Text>
          </View>
        </Pressable>
        <View className="flex-1">
          <Pressable {...press} hitSlop={{ top: 16 }}>
            <Text className="font-sansSemi text-base text-textPrimary" numberOfLines={1}>
              {label}
            </Text>
          </Pressable>
          {holding.ticker && holding.name ? (
            // Scrolls sideways inside the name column rather than ellipsizing, so a long fund name
            // ("Tidal Trust II - Defiance Daily Target…") stays fully readable without pushing
            // the figures. Height is pinned: a horizontal ScrollView otherwise has no height of
            // its own to lay out against.
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              className="mt-0.5"
              style={{ height: NAME_LINE_HEIGHT }}
            >
              <Pressable {...press} hitSlop={{ bottom: 16 }}>
                <Text className="font-sans text-sm text-textSecondary" style={{ lineHeight: NAME_LINE_HEIGHT }}>
                  {holding.name}
                </Text>
              </Pressable>
            </ScrollView>
          ) : null}
        </View>
        <Pressable {...press} className="items-end gap-0.5">
          <Text className="font-sansSemi text-base text-textPrimary" numberOfLines={1}>
            {holding.institutionValue != null ? formatMaskableAmount(holding.institutionValue, isMasked) : '—'}
          </Text>
          <Text
            className="font-sans text-xs"
            style={{ color: gain != null ? performanceColor(gainPct).base : colors.textMuted }}
            numberOfLines={1}
          >
            {gainText}
          </Text>
        </Pressable>
      </View>
      {/* Labelled stats in columns rather than one run-on line: each figure sits under its own
          name, so the eye finds "price" without parsing a sentence. Each column is centred across
          the full row width.
          A hairline and real spacing set it apart from the row, so the two read as a header and
          its stats rather than one block. Tapping it closes the row like any other part. */}
      {isSelected ? (
        <Pressable
          {...press}
          className="mt-4 flex-row pt-4"
          style={{ borderTopWidth: 1, borderColor: hexToRgba(colors.primary, 0.15) }}
        >
          {details.map((d) => (
            <View key={d.label} className="flex-1 items-center">
              <Text className="font-sansMed text-sm text-textSecondary">{d.label}</Text>
              <Text className="mt-1 font-sansSemi text-base text-textPrimary">{d.value}</Text>
            </View>
          ))}
        </Pressable>
      ) : null}
    </View>
  )
}
