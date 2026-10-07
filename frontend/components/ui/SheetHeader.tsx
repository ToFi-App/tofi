import type { ReactNode } from 'react'
import { Pressable, Text, View } from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import { colors } from '@/constants/theme'

const SLOT = 22

/**
 * The top row every bottom sheet opens with: close on the left, the title centred, and an optional
 * action on the right. One component so no sheet can ship without its close button, and so they all
 * sit at the same height with the same spacing.
 *
 * The right slot is always reserved at the close button's width, action or not — that is what
 * centres the title on the sheet rather than on the space left over.
 */
export function SheetHeader({
  title,
  onClose,
  right,
  closeDisabled = false,
  onBack,
}: {
  title: string
  onClose: () => void
  /** Turns the leading button into a back chevron, for a view pushed inside the sheet. */
  onBack?: () => void
  /** An action for the right slot, sized like the close button (a 22pt icon). */
  right?: ReactNode
  /** Holds the sheet open, e.g. while something irreversible is in flight. */
  closeDisabled?: boolean
}) {
  return (
    <View className="flex-row items-center gap-3 px-5 py-3">
      <Pressable
        onPress={onBack ?? onClose}
        hitSlop={8}
        disabled={closeDisabled}
        accessibilityRole="button"
        accessibilityLabel={onBack ? 'Back' : 'Close'}
      >
        <Ionicons name={onBack ? 'chevron-back' : 'close'} size={SLOT} color={colors.textSecondary} />
      </Pressable>
      <Text className="flex-1 text-center font-display text-md text-textPrimary" numberOfLines={1}>
        {title}
      </Text>
      <View style={{ width: SLOT, alignItems: 'flex-end' }}>{right}</View>
    </View>
  )
}
