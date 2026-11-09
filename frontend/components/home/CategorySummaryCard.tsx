import { Text, View } from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import { colors, hexToRgba } from '@/constants/theme'
import { formatMaskableAmount } from '@/lib/format/money'
import { useAmountsMasked } from '@/hooks/useAmountsMasked'
import { Card } from '@/components/ui/Card'
import { TileIcon } from '@/components/ui/TileIcon'
import { CategoryIcon } from '@/components/categories/CategoryIcon'
import type { GridTile } from './TileRows'

/** How many categories the card lists before "See all". */
const PREVIEW_ROWS = 3
const BAR_HEIGHT = 8
const ROW_ICON = 26
/** Inter's tabular figures: digits all one width, so the amounts line up down the rows. */
const TABULAR = { fontVariant: ['tabular-nums' as const] }

interface CategorySummaryCardProps {
  title: 'Expenses' | 'Income'
  total: number
  tiles: GridTile[]
  onPress: () => void
}

/**
 * Home's preview of a month's expenses or income: the total, a bar of how it splits by category, and
 * the biggest few categories as rows. The whole card opens the full page of tiles, where the rest —
 * every category, budget rings and all — lives. Matches Home's other cards, so the sheet reads as one
 * column of them.
 */
export function CategorySummaryCard({ title, total, tiles, onPress }: CategorySummaryCardProps) {
  const { isMasked } = useAmountsMasked()
  const isExpense = title === 'Expenses'
  const tone = isExpense ? colors.expense : colors.income
  // Largest first, whatever order the grid packs them in; zero-amount categories have nothing to draw.
  const ranked = [...tiles].filter((t) => t.spent > 0).sort((a, b) => b.spent - a.spent)
  const shown = ranked.slice(0, PREVIEW_ROWS)
  const hidden = tiles.length - shown.length

  return (
    <Card
      onPress={onPress}
      accessibilityLabel={`${title}, ${formatMaskableAmount(total, isMasked)}. See all categories`}
      style={{ padding: 16, gap: 12 }}
    >
      <View className="flex-row items-center justify-between gap-2">
        <View className="flex-row items-center gap-2">
          <TileIcon name={isExpense ? 'arrow-up' : 'arrow-down'} color={tone} />
          <Text className="font-sansSemi text-base text-textPrimary">{title}</Text>
        </View>
        <View className="flex-row items-center gap-2">
          <Text className="font-sansSemi text-base" style={[TABULAR, { color: tone }]}>
            {formatMaskableAmount(total, isMasked)}
          </Text>
          <View
            className="items-center justify-center rounded-full"
            style={{ width: 24, height: 24, backgroundColor: colors.surfaceRaised }}
          >
            <Ionicons name="chevron-forward" size={13} color={colors.textPrimary} />
          </View>
        </View>
      </View>

      {/* The month's split, each category its share of the bar in its own colour. */}
      {ranked.length > 0 ? (
        <View className="flex-row overflow-hidden rounded-full" style={{ height: BAR_HEIGHT, gap: 2 }}>
          {ranked.map((t) => (
            <View key={t.id} style={{ flex: t.spent, backgroundColor: t.color }} />
          ))}
        </View>
      ) : null}

      <View>
        {shown.map((t, i) => (
          <View
            key={t.id}
            className="flex-row items-center gap-3 py-2"
            style={i > 0 ? { borderTopWidth: 1, borderColor: colors.border } : undefined}
          >
            <View
              className="items-center justify-center rounded-full"
              style={{ width: ROW_ICON, height: ROW_ICON, backgroundColor: hexToRgba(t.color, 0.2) }}
            >
              <CategoryIcon icon={t.icon} size={13} color={t.color} />
            </View>
            <Text className="flex-1 font-sans text-sm text-textPrimary" numberOfLines={1}>
              {t.name}
            </Text>
            <Text className="font-sansMed text-sm text-textPrimary" style={TABULAR}>
              {formatMaskableAmount(t.spent, isMasked)}
            </Text>
          </View>
        ))}
      </View>

      {hidden > 0 ? (
        <Text className="font-sansMed text-sm" style={{ color: colors.primary }}>
          +{hidden} more · See all
        </Text>
      ) : null}
    </Card>
  )
}
