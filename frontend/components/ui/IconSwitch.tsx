import type { ComponentProps } from 'react'
import { Pressable, View } from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import { colors, hexToRgba } from '@/constants/theme'

export interface IconSwitchOption<T extends string> {
  value: T
  icon: ComponentProps<typeof Ionicons>['name']
  /** Read aloud in place of the icon. */
  label: string
}

/**
 * Two or three views of the same thing as a small row of icons in a track — Home's summary or
 * charts, Investments' trend or breakdown, the spending chart's gap or totals. Icons rather than
 * worded pills: a switch between views of one screen sits under, or beside, that screen's heading,
 * and words would make it compete with the heading.
 */
export function IconSwitch<T extends string>({
  options,
  value,
  onChange,
  size = 'md',
  tone = 'default',
}: {
  options: Array<IconSwitchOption<T>>
  value: T
  onChange: (value: T) => void
  /** 'sm' for a switch inside a section's header row, 'md' beside a screen's heading. */
  size?: 'sm' | 'md'
  /** 'inverse' for a header on the brand colour. */
  tone?: 'default' | 'inverse'
}) {
  const isInverse = tone === 'inverse'
  return (
    <View
      className="flex-row rounded-full"
      style={{ backgroundColor: isInverse ? hexToRgba(colors.textInverse, 0.16) : colors.surfaceRaised, padding: 2 }}
    >
      {options.map((option) => {
        const selected = option.value === value
        return (
          <Pressable
            key={option.value}
            onPress={() => onChange(option.value)}
            accessibilityRole="button"
            accessibilityLabel={option.label}
            accessibilityState={{ selected }}
            hitSlop={4}
            className={size === 'sm' ? 'rounded-full px-2 py-0.5' : 'rounded-full px-2.5 py-1'}
            style={selected ? { backgroundColor: isInverse ? colors.textInverse : colors.surface } : undefined}
          >
            <Ionicons
              name={option.icon}
              size={size === 'sm' ? 14 : 16}
              color={selected ? colors.primary : isInverse ? hexToRgba(colors.textInverse, 0.72) : colors.textMuted}
            />
          </Pressable>
        )
      })}
    </View>
  )
}
