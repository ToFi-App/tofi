import { Pressable, Text, View } from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import { CategoryIcon } from '@/components/categories/CategoryIcon'
import { colors, hexToRgba } from '@/constants/theme'
import { formatMaskableAmount } from '@/lib/format/money'
import { useAmountsMasked } from '@/hooks/useAmountsMasked'

interface CategoryBreakdownRowProps {
  icon: string | null
  name: string
  color: string
  percentage: number
  amount: number
  transactionCount: number
  onPress?: () => void
}

export function CategoryBreakdownRow({ icon, name, color, percentage, amount, transactionCount, onPress }: CategoryBreakdownRowProps) {
  const { isMasked } = useAmountsMasked()
  return (
    <Pressable onPress={onPress} style={{ gap: 8, paddingVertical: 12 }}>
      <View className="flex-row items-center">
        <View
          className="items-center justify-center rounded-full"
          style={{ width: 32, height: 32, backgroundColor: hexToRgba(color, 0.2), marginRight: 12 }}
        >
          <CategoryIcon icon={icon} size={16} color={color} />
        </View>

        <Text className="font-sansSemi text-base text-textPrimary" style={{ flexShrink: 1 }}>
          {name}
        </Text>

        <View className="rounded-full bg-surfaceRaised" style={{ marginLeft: 8, paddingHorizontal: 8, paddingVertical: 2 }}>
          <Text className="font-mono text-xs text-textSecondary">{percentage.toFixed(1)}%</Text>
        </View>

        <View style={{ flex: 1 }} />

        <View className="items-end">
          <Text className="font-display text-base text-textPrimary">{formatMaskableAmount(amount, isMasked)}</Text>
          <Text className="font-sans text-xs text-textMuted">
            {transactionCount} {transactionCount === 1 ? 'txn' : 'txns'}
          </Text>
        </View>

        {onPress ? <Ionicons name="chevron-forward" size={16} color={colors.textMuted} style={{ marginLeft: 4 }} /> : null}
      </View>

      <View className="rounded-full bg-surfaceRaised" style={{ height: 5, overflow: 'hidden' }}>
        <View className="rounded-full" style={{ height: 5, width: `${Math.min(100, percentage)}%`, backgroundColor: color }} />
      </View>
    </Pressable>
  )
}
