import type { ReactNode } from 'react'
import { Pressable } from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import { colors } from '@/constants/theme'
import { useAmountsMasked } from '@/hooks/useAmountsMasked'

/**
 * A screen's headline amount with the eye beside it, the two as one tap target: tapping the number
 * hides it as surely as tapping the eye. It flips the one app-wide masking setting, so hiding
 * amounts on Home hides them on Net Worth and Investments too.
 */
export function MaskToggle({
  children,
  size = 20,
  color = colors.textMuted,
}: {
  children: ReactNode
  size?: number
  /** The eye's colour; a headline on the brand colour passes a softened white. */
  color?: string
}) {
  const { isMasked, toggleMask } = useAmountsMasked()
  return (
    <Pressable
      onPress={toggleMask}
      hitSlop={10}
      accessibilityRole="button"
      accessibilityLabel={isMasked ? 'Show amounts' : 'Hide amounts'}
      className="shrink flex-row items-center gap-2"
    >
      {children}
      <Ionicons name={isMasked ? 'eye-off' : 'eye'} size={size} color={color} />
    </Pressable>
  )
}
