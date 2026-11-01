import { Pressable, Text, View } from 'react-native'
import { blendOver, colors, hexToRgba, shadow } from '@/constants/theme'
import { BudgetRing } from './BudgetRing'
import { CategoryIcon } from './CategoryIcon'
import { formatAmount } from '@/lib/format/money'
import type { TileState } from '@/lib/home/categoryTiles'

const ICON_WELL = 36
const RING_SIZE = 46
const RING_STROKE = 3.5
const BAR_GAP = 1.5

interface CategoryCardProps {
  name: string
  icon: string | null
  color: string
  spent: number
  budget: number | null
  /** Drives the ring's colour and the over-budget edge; 'unbudgeted' draws no ring. */
  state: TileState
  /** A wide tile spans two grid columns, laid out sideways with the month's daily spending. */
  wide?: boolean
  /** One entry per day of the month so far, for a wide tile's bars. */
  dailySpend?: number[]
  width?: number
  height?: number
  onPress?: () => void
}

/**
 * One category on Home's grid. The tile changes form with its budget rather than adding cards
 * around it: no budget, no ring; on track, a ring in the category's colour; running ahead of pace,
 * the ring turns amber; over, the ring and the amount go red. Name, ring and amount — nothing else,
 * so the tile stays short.
 */
export function CategoryCard({
  name,
  icon,
  color,
  spent,
  budget,
  state,
  wide = false,
  dailySpend,
  width,
  height,
  onPress,
}: CategoryCardProps) {
  const isOver = state === 'over'
  const arcColor = isOver ? colors.expense : state === 'at-risk' ? colors.warning : color
  // The tile keeps its category's colour whatever its state, so the grid still reads by category;
  // being over shows in the ring and the amount.
  // Opaque — the tint laid over the page — so the shadow has a solid shape to fall from; on a
  // translucent fill iOS draws it through the tile, faint and smeared.
  const surface = blendOver(color, 0.16, colors.background)

  const badge = (
    <View style={{ width: RING_SIZE, height: RING_SIZE }} className="items-center justify-center">
      {budget != null ? (
        <BudgetRing fraction={budget > 0 ? spent / budget : 0} color={color} arcColor={arcColor} size={RING_SIZE} stroke={RING_STROKE} />
      ) : null}
      <View className="items-center justify-center rounded-full" style={{ width: ICON_WELL, height: ICON_WELL, backgroundColor: hexToRgba(color, 0.28) }}>
        <CategoryIcon icon={icon} size={18} color={color} />
      </View>
    </View>
  )

  const amount = (
    <Text className="font-display text-md" style={{ color: isOver ? colors.expense : colors.textPrimary }} numberOfLines={1} adjustsFontSizeToFit>
      {formatAmount(spent)}
    </Text>
  )

  const frame = { width, height, backgroundColor: surface, ...shadow.sm }

  if (wide) {
    const peak = Math.max(0, ...(dailySpend ?? []))
    return (
      <Pressable onPress={onPress} accessibilityRole={onPress ? 'button' : undefined} className="flex-row items-center gap-3 rounded-xl px-3 py-2" style={frame}>
        {badge}
        <View className="flex-1 gap-0.5">
          <Text className="font-sansSemi text-sm text-textSecondary" numberOfLines={1}>
            {name}
          </Text>
          {amount}
          {/* The month by day, so a big category shows whether it was one purchase or a habit. */}
          {dailySpend && peak > 0 ? (
            <View className="mt-1.5 flex-row items-end" style={{ height: 24, gap: BAR_GAP }}>
              {dailySpend.map((value, day) => (
                <View
                  key={day}
                  style={{
                    flex: 1,
                    height: value > 0 ? Math.max(2, (value / peak) * 24) : 1,
                    borderRadius: 1,
                    backgroundColor: value > 0 ? color : hexToRgba(color, 0.25),
                  }}
                />
              ))}
            </View>
          ) : null}
        </View>
      </Pressable>
    )
  }

  return (
    <Pressable onPress={onPress} accessibilityRole={onPress ? 'button' : undefined} className="items-center justify-center gap-1 rounded-xl px-2 py-2" style={frame}>
      <Text className="font-sansSemi text-sm text-textSecondary" numberOfLines={1}>
        {name}
      </Text>
      {badge}
      {amount}
    </Pressable>
  )
}
