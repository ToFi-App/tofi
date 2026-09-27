import { useState } from 'react'
import { View } from 'react-native'
import { MIN_LABEL_SIZE, TreemapTile } from '@/components/accounts/TreemapTile'
import { assetClass } from '@/lib/accounts/holdings'
import { computeAllocation, squarify } from '@/lib/accounts/treemap'
import type { Holding } from '@/types/domain'

const MAP_HEIGHT = 220

/**
 * Fill opacity for the largest holding in a class, stepping down for each smaller one.
 * Two same-class neighbours are otherwise the identical colour and read as a single shape
 * split by a gap — stepping the tint separates them without inventing a hue that would
 * imply they are different KINDS of asset. It also reinforces the ordering the areas
 * already encode, so bigger positions read heavier.
 *
 * Floors at MIN so a long tail of small positions never fades into the background.
 */
const TILE_TINT_MAX = 0.36
const TILE_TINT_STEP = 0.05
const TILE_TINT_MIN = 0.2
/** Slivers carry no label, so they can take more colour without a contrast cost. */
const SLIVER_TINT = 0.48

// Portfolio allocation treemap: tile area = share of market value, color = ASSET CLASS.
// Deliberately not performance-colored — red/green on a treemap reads as "today's
// movement" (finviz), which vs-cost or stale-price tints would falsely imply. Layout
// comes from lib/accounts/treemap so it's testable.
//
// No legend: the holding rows below group under coloured asset-class headers, which explain the
// tile colours, and a tapped tile highlights the row that names it (selection is the caller's).
export function HoldingsHeatMap({
  holdings,
  selectedId,
  onSelect,
}: {
  holdings: Holding[]
  selectedId: string | null
  onSelect: (securityId: string | null) => void
}) {
  const [width, setWidth] = useState(0)
  const allocation = computeAllocation(holdings)
  if (allocation.length === 0) return null

  const rects = width > 0 ? squarify(allocation, width, MAP_HEIGHT) : []

  // Rank within asset class. computeAllocation is already sorted by weight desc, so a
  // running count per class assigns 0 to that class's largest holding.
  const rankInClass = new Map<string, number>()
  const seenPerClass = new Map<string, number>()
  for (const item of allocation) {
    const key = assetClass(item.type).key
    const next = seenPerClass.get(key) ?? 0
    rankInClass.set(item.securityId, next)
    seenPerClass.set(key, next + 1)
  }
  const tintFor = (securityId: string) =>
    Math.max(TILE_TINT_MAX - (rankInClass.get(securityId) ?? 0) * TILE_TINT_STEP, TILE_TINT_MIN)

  return (
    <View onLayout={(e) => setWidth(e.nativeEvent.layout.width)} style={{ height: MAP_HEIGHT }}>
      {rects.map(({ item, x, y, width: w, height: h }) => {
        const showLabel = w >= MIN_LABEL_SIZE && h >= MIN_LABEL_SIZE
        const cls = assetClass(item.type)
        return (
          <TreemapTile
            key={item.securityId}
            x={x}
            y={y}
            width={w}
            height={h}
            color={cls.color}
            textColor={cls.textColor}
            tint={showLabel ? tintFor(item.securityId) : SLIVER_TINT}
            title={item.label}
            share={`${(item.weight * 100).toFixed(item.weight >= 0.1 ? 0 : 1)}%`}
            isSelected={item.securityId === selectedId}
            onPress={() => onSelect(item.securityId === selectedId ? null : item.securityId)}
          />
        )
      })}
    </View>
  )
}
