import { Ionicons } from '@expo/vector-icons'
import type { ComponentProps } from 'react'
import { Pressable, Text, View } from 'react-native'
import { colors, hexToRgba } from '@/constants/theme'

interface SettingsRowProps {
  icon: ComponentProps<typeof Ionicons>['name']
  label: string
  onPress: () => void
  tone?: 'default' | 'danger'
}

/**
 * One row of a settings group (SettingsGroup): its glyph in a tinted well — brand teal, or red for
 * the destructive rows — then the label, and a chevron for rows that open a screen.
 */
export function SettingsRow({ icon, label, onPress, tone = 'default' }: SettingsRowProps) {
  const isDanger = tone === 'danger'
  const accent = isDanger ? colors.expense : colors.primary

  return (
    <Pressable onPress={onPress} accessibilityRole="button" className="flex-row items-center gap-3 px-4 py-3 active:bg-surfaceRaised">
      <View className="h-8 w-8 items-center justify-center rounded-lg" style={{ backgroundColor: isDanger ? hexToRgba(colors.expense, 0.1) : colors.primaryMuted }}>
        <Ionicons name={icon} size={17} color={accent} />
      </View>
      <Text className="flex-1 font-sansMed text-base" style={{ color: isDanger ? colors.expense : colors.textPrimary }}>
        {label}
      </Text>
      {isDanger ? null : <Ionicons name="chevron-forward" size={18} color={colors.textSecondary} />}
    </Pressable>
  )
}
