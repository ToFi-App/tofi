import type { ComponentProps } from 'react'
import { View } from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import { colors } from '@/constants/theme'

/**
 * A section's mark at the head of its row: a brand-coloured glyph in the brand's tinted well, the
 * category tiles' badge style. Home's sheet rows — Cash Flow, Budget, Spending — each lead with
 * one, which is what makes them read as one list of things to check.
 */
export function SectionBadge({ icon, size = 15 }: { icon: ComponentProps<typeof Ionicons>['name']; size?: number }) {
  return (
    <View className="h-8 w-8 items-center justify-center rounded-full" style={{ backgroundColor: colors.primaryMuted }}>
      <Ionicons name={icon} size={size} color={colors.primary} />
    </View>
  )
}
