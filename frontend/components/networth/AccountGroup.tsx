import type { ReactNode } from 'react'
import { Pressable, Text, View } from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import { colors } from '@/constants/theme'
import { formatMaskableAmount } from '@/lib/format/money'

/**
 * One kind of money on the Overview — cash, investments, credit: its name and total on one quiet
 * line, and its accounts under it as their own rows. Tapping the line folds the group away.
 */
export function AccountGroup({
  title,
  total,
  isMasked,
  isOpen,
  onToggle,
  children,
}: {
  title: string
  total: number
  isMasked: boolean
  isOpen: boolean
  onToggle: () => void
  children: ReactNode
}) {
  return (
    <View className="gap-2">
      <Pressable
        onPress={onToggle}
        accessibilityRole="button"
        accessibilityLabel={`${title}, ${formatMaskableAmount(total, isMasked)}`}
        accessibilityState={{ expanded: isOpen }}
        className="flex-row items-center gap-1.5 py-1"
      >
        <Text className="flex-1 font-sansMed text-sm text-textSecondary">{title}</Text>
        <Text className="font-sansSemi text-sm text-textPrimary" style={{ fontVariant: ['tabular-nums'] }}>
          {formatMaskableAmount(total, isMasked)}
        </Text>
        <Ionicons name={isOpen ? 'chevron-down' : 'chevron-forward'} size={13} color={colors.textMuted} />
      </Pressable>
      {isOpen ? children : null}
    </View>
  )
}

/** Each row's space below it, inside its drag wrapper, so a lifted row's measured height includes it. */
export function RowGap({ children }: { children: ReactNode }) {
  return <View className="pb-2">{children}</View>
}
