import { useState } from 'react'
import { Pressable, Text, View } from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import { blendOver, colors, hexToRgba } from '@/constants/theme'
import { ScrollingText } from '@/components/ui/ScrollingText'
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
import { securityLogoUrl } from '@/lib/investments/securityLogo'
import { SecurityMark } from './SecurityMark'
import type { Holding } from '@/types/domain'

/** Pinned height for the scrolling name line (text-sm). */
const NAME_LINE_HEIGHT = 18
// How strongly a selected row is tinted with the primary colour.
const SELECTED_TINT = 0.1
/** A row's top and bottom padding: tight enough that a long portfolio stays scannable. */
const ROW_PADDING = 10
/** The brief tint under a finger pressing a row that opens a page. */
const PRESSED_TINT = 0.05
/** A change in a holding's value: dollars, and the share of where it started. */
export type HoldingChange = { gain: number; pct: number | null }

interface HoldingRowsProps {
  holdings: Holding[]
  isMasked: boolean
  /** The highlighted holding — from a tapped tile or a tapped row. Its row is tinted and opens. */
  selectedId: string | null
  onSelect: (securityId: string | null) => void
  /** Opens a holding's own page. When given, tapping a row opens it instead of highlighting it. */
  onOpen?: (securityId: string) => void
  /** One list by value, without the asset-class headers — for rows already grouped under an
   *  account, where a second level of headers would only stack up. The monograms keep the class. */
  flat?: boolean
  /** Each row's change over the window the chart above shows, in place of its total return — so
   *  the rows read the same range the chart does. Null: no figure for that window. */
  changeFor?: (holding: Holding) => HoldingChange | null
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
export function HoldingRows({
  holdings,
  isMasked,
  selectedId,
  onSelect,
  onOpen,
  flat = false,
  changeFor,
}: HoldingRowsProps) {
  const rowFor = (holding: Holding, isFirst: boolean) => (
    <HoldingRow
      key={holding.securityId}
      holding={holding}
      isMasked={isMasked}
      isFirst={isFirst}
      isSelected={holding.securityId === selectedId}
      opensPage={onOpen != null}
      change={changeFor ? changeFor(holding) : undefined}
      onPress={() => (onOpen ? onOpen(holding.securityId) : onSelect(holding.securityId === selectedId ? null : holding.securityId))}
    />
  )
  if (flat) return <View>{sortHoldingsByValue(holdings).map((holding, i) => rowFor(holding, i === 0))}</View>

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
          {rows.map((holding, rowIndex) => rowFor(holding, rowIndex === 0))}
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
  opensPage,
  onPress,
  change,
}: {
  holding: Holding
  /** Over the chart's window, replacing the total return; undefined keeps the total return. */
  change?: HoldingChange | null
  isMasked: boolean
  isFirst: boolean
  isSelected: boolean
  /** Tapping opens the holding's page: shown with a chevron, like the app's other rows that do. */
  opensPage: boolean
  onPress: () => void
}) {
  // The row is several Pressables (see below), so they share one pressed state and the whole row
  // lights up under the finger rather than whichever part was touched.
  const [isPressed, setIsPressed] = useState(false)
  const label = holdingLabel(holding)
  const cls = assetClass(holding.type)
  const gain = change !== undefined ? (change?.gain ?? null) : holdingGain(holding)
  const gainPct = change !== undefined ? (change?.pct ?? null) : holdingGainPct(holding)
  const avg = averageCost(holding)
  // GAIN% is unmasked on purpose — a ratio discloses no balance, and privacy mode is most
  // useful when it still answers "how is this doing".
  const gainText =
    gain != null
      ? `${gain > 0 ? '+' : ''}${formatCompactMaskableAmount(gain, isMasked)} (${formatGainPct(gainPct)})`
      : change !== undefined
        ? '—'
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
  // The fades must match what's behind the name, which a selected row tints.
  const fadeColor = isSelected ? blendOver(colors.primary, SELECTED_TINT, colors.surface) : colors.surface
  const press = {
    onPress,
    onPressIn: () => setIsPressed(true),
    onPressOut: () => setIsPressed(false),
    hitSlop: { top: ROW_PADDING, bottom: ROW_PADDING },
    accessibilityRole: 'button' as const,
    accessibilityState: { selected: isSelected },
  }

  return (
    <View
      style={[
        { paddingVertical: ROW_PADDING },
        !isFirst ? { borderTopWidth: 1, borderColor: colors.border } : null,
        // Widened by 12px each side with the same 12px padded back in, so the highlight gets a
        // margin around its content without moving it.
        isSelected
          ? { marginHorizontal: -12, paddingHorizontal: 12, borderRadius: 14, backgroundColor: hexToRgba(colors.primary, SELECTED_TINT) }
          : isPressed
            ? { marginHorizontal: -12, paddingHorizontal: 12, borderRadius: 14, backgroundColor: hexToRgba(colors.textPrimary, PRESSED_TINT) }
            : null,
      ]}
    >
      <View className="flex-row items-center gap-3">
        <Pressable {...press}>
          <SecurityMark uri={securityLogoUrl(holding)} monogram={monogramText(label)} color={cls.color} size={32} />
        </Pressable>
        <View className="flex-1">
          <ScrollingText
            className="font-sansSemi text-base text-textPrimary"
            pressProps={{ ...press, hitSlop: { top: ROW_PADDING } }}
            fadeColor={fadeColor}
          >
            {label}
          </ScrollingText>
          {holding.ticker && holding.name ? (
            // Scrolls sideways inside the name column rather than ellipsizing, so a long fund name
            // ("Tidal Trust II - Defiance Daily Target…") stays fully readable without pushing
            // the figures. Height is pinned: a horizontal ScrollView otherwise has no height of
            // its own to lay out against.
            <View className="mt-0.5">
              <ScrollingText
                className="font-sans text-sm text-textSecondary"
                textStyle={{ lineHeight: NAME_LINE_HEIGHT }}
                style={{ height: NAME_LINE_HEIGHT }}
                pressProps={{ ...press, hitSlop: { bottom: ROW_PADDING } }}
                fadeColor={fadeColor}
              >
                {holding.name}
              </ScrollingText>
            </View>
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
        {opensPage ? (
          // Pulled in against the row's 16pt gap: the chevron belongs to the figures beside it.
          <Pressable {...press} hitSlop={{ top: ROW_PADDING, bottom: ROW_PADDING, right: 8 }} style={{ marginLeft: -4 }}>
            <Ionicons name="chevron-forward" size={16} color={colors.textMuted} />
          </Pressable>
        ) : null}
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

/** A share of the whole portfolio, as a quiet pill beside the name it belongs to. */
export function SharePill({ share }: { share: number }) {
  return (
    <View className="rounded-full px-2 py-0.5" style={{ backgroundColor: colors.surfaceRaised }}>
      <Text className="font-sansSemi text-xs text-textPrimary">{share > 0 && share < 0.005 ? '<1%' : `${Math.round(share * 100)}%`}</Text>
    </View>
  )
}
