import { Pressable, Text, View } from 'react-native'
import { colors, hexToRgba } from '@/constants/theme'
import { BudgetRing } from '@/components/categories/BudgetRing'
import { CategoryIcon } from '@/components/categories/CategoryIcon'
import { formatAmount } from '@/lib/format/money'
import type { BudgetStatus } from '@/lib/budgets/budgetMath'
import { statusColor } from './statusColor'

interface BudgetBadgeProps {
  icon: string | null
  color?: string
  spent: number
  /** The budget; null for a category without one, which gets the badge without a ring. */
  amount: number | null
  status: BudgetStatus
  size: number
}

/**
 * Home's two-tone icon badge inside a budget ring. The ring stays in the category's own color while
 * all is well and takes the health color once it isn't, so a problem stands out from a screen of
 * calm rings.
 */
export function BudgetBadge({ icon, color = colors.textMuted, spent, amount, status, size }: BudgetBadgeProps) {
  const well = Math.round(size * 0.75)
  return (
    <View style={{ width: size, height: size }} className="items-center justify-center">
      {amount != null ? (
        <BudgetRing
          fraction={amount > 0 ? spent / amount : 0}
          color={color}
          arcColor={status === 'on-track' ? color : statusColor(status)}
          size={size}
          stroke={size >= 60 ? 4 : 3.5}
        />
      ) : null}
      <View className="items-center justify-center rounded-full" style={{ width: well, height: well, backgroundColor: hexToRgba(color, 0.2) }}>
        <CategoryIcon icon={icon} size={Math.round(size * 0.34)} color={color} />
      </View>
    </View>
  )
}

interface BudgetRingTileProps {
  name: string
  icon: string | null
  /** The category's color; missing for a category that no longer exists. */
  color?: string
  spent: number
  amount: number
  status: BudgetStatus
  onPress: () => void
}

/**
 * One budget in the grid: its badge, then what's left in dollars. Dollars rather than a percentage,
 * because "60%" can't say whether it means spent or left.
 */
export function BudgetRingTile({ name, icon, color = colors.textMuted, spent, amount, status, onPress }: BudgetRingTileProps) {
  const remaining = amount - spent
  const isOnTrack = status === 'on-track'
  const tone = isOnTrack ? colors.textPrimary : statusColor(status)

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${name}, ${formatAmount(Math.abs(remaining))} ${remaining < 0 ? 'over' : 'left'}`}
      className="items-center gap-1.5 py-2"
    >
      <View className="mb-1">
        <BudgetBadge icon={icon} color={color} spent={spent} amount={amount} status={status} size={64} />
      </View>
      <Text className="font-sansMed text-sm text-textPrimary" numberOfLines={1}>
        {name}
      </Text>
      <Text className="font-mono text-sm" style={{ color: tone }} numberOfLines={1} adjustsFontSizeToFit>
        {formatAmount(Math.abs(remaining))}
        <Text className="font-sans text-xs" style={{ color: isOnTrack ? colors.textMuted : tone }}>
          {remaining < 0 ? ' over' : ' left'}
        </Text>
      </Text>
    </Pressable>
  )
}
