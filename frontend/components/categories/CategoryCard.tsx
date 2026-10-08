import { Pressable, Text, View } from 'react-native'
import { colors, hexToRgba } from '@/constants/theme'
import { BudgetRing } from './BudgetRing'
import { CategoryIcon } from './CategoryIcon'
import { formatAmount } from '@/lib/format/money'

const ICON_WELL = 44
const RING_SIZE = 54
const RING_STROKE = 3.5

interface CategoryCardProps {
  name: string
  icon: string | null
  color: string
  spent: number
  budget: number | null
  onPress?: () => void
}

export function CategoryCard({ name, icon, color, spent, budget, onPress }: CategoryCardProps) {
  const cardSurface = hexToRgba(color, 0.16)
  const iconBg = hexToRgba(color, 0.28)

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole={onPress ? 'button' : undefined}
      className="items-center gap-2 rounded-xl py-4 px-2"
      style={{ backgroundColor: cardSurface }}
    >
      <Text className="font-sansSemi text-sm text-textSecondary">{name}</Text>

      <View style={{ width: RING_SIZE, height: RING_SIZE }} className="items-center justify-center">
        {/* No budget, no ring. The arc flips to the expense red once the budget is blown. */}
        {budget != null ? (
          <BudgetRing
            fraction={budget > 0 ? spent / budget : 0}
            color={color}
            arcColor={spent > budget ? colors.expense : color}
            size={RING_SIZE}
            stroke={RING_STROKE}
          />
        ) : null}
        <View
          className="items-center justify-center rounded-full"
          style={{ width: ICON_WELL, height: ICON_WELL, backgroundColor: iconBg }}
        >
          <CategoryIcon icon={icon} size={20} color={color} />
        </View>
      </View>

      <Text className="font-display text-md text-textPrimary">{formatAmount(spent)}</Text>
    </Pressable>
  )
}
