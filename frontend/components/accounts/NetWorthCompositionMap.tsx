import { useMemo, useState } from 'react'
import { View } from 'react-native'
import { TreemapTile } from '@/components/accounts/TreemapTile'
import { GROUP_COLORS, fallbackIconFor } from '@/components/accounts/netWorthPalette'
import { computeNetWorthComposition, layoutComposition } from '@/lib/accounts/composition'
import type { Account } from '@/types/domain'
import type { FeedItem } from '@/lib/transactions/resolveFeed'

/**
 * Fixed. The map does not grow to accommodate small tiles: areas are true, so a tiny holding
 * is a tiny tile, and tapping is how it says what it is.
 */
const MAP_HEIGHT = 220
const ACCOUNT_TINT_MAX = 0.4
const ACCOUNT_TINT_STEP = 0.06
const ACCOUNT_TINT_MIN = 0.22

/**
 * What net worth is made of in one month (today's by default): asset groups, the accounts inside
 * them, and the debt held against the whole thing.
 *
 * Debt shares the cash block as tiles sized by the amount owed, so every tile's area is a share
 * of the gross balance sheet — see composition.ts.
 */
export function NetWorthCompositionMap({
  accounts,
  feed,
  balances,
  selectedKey,
  onSelectKey,
}: {
  accounts: Account[]
  feed: FeedItem[]
  /** A month's signed balances (computeAccountHistory) to draw instead of today's. */
  balances?: Map<string, number>
  /**
   * The tapped tile, owned by the caller. A treemap can only label tiles with room for a label;
   * rather than a caption of its own, the map hands the selection out so the account list can
   * highlight the row that names it.
   */
  selectedKey: string | null
  onSelectKey: (key: string | null) => void
}) {
  const [width, setWidth] = useState(0)
  const { groups } = useMemo(() => computeNetWorthComposition(accounts, feed, balances), [accounts, feed, balances])
  const { layouts, height: mapHeight } = useMemo(
    () => (width > 0 ? layoutComposition(groups, width, MAP_HEIGHT) : { layouts: [], height: MAP_HEIGHT }),
    [groups, width],
  )

  if (groups.length === 0) return null

  // No legend and no caption: the account rows below carry both jobs — their coloured group
  // headers explain the tile colours, and a tapped tile lights up the row that names it.
  return (
    <View onLayout={(e) => setWidth(e.nativeEvent.layout.width)} style={{ height: mapHeight }}>
      {layouts.map(({ group, accounts: tiles }) => {
        return (
          <View key={group.key}>
            {tiles.map(({ item, x, y, width: w, height: h }, index) => (
              <TreemapTile
                key={item.key}
                x={x}
                y={y}
                width={w}
                height={h}
                // Per account, not per block: debt sits among the cash tiles and colour is
                // the only thing left distinguishing it.
                color={(item.isLiability ? GROUP_COLORS.liability : GROUP_COLORS[group.key]).fill}
                textColor={(item.isLiability ? GROUP_COLORS.liability : GROUP_COLORS[group.key]).text}
                // Stepped like the holdings map: two same-colour neighbours would otherwise
                // read as one shape split by a gap.
                tint={Math.max(ACCOUNT_TINT_MAX - index * ACCOUNT_TINT_STEP, ACCOUNT_TINT_MIN)}
                title={item.label}
                logo={item.logo}
                fallbackIcon={fallbackIconFor(item.isLiability ? 'liability' : group.key, item.key, item.itemId)}
                share={`${item.shareOfTotal >= 0.1 ? Math.round(item.shareOfTotal * 100) : (item.shareOfTotal * 100).toFixed(1)}%`}
                isSelected={item.key === selectedKey}
                onPress={() => onSelectKey(item.key === selectedKey ? null : item.key)}
              />
            ))}
          </View>
        )
      })}
    </View>
  )
}
