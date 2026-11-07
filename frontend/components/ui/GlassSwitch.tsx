import type { ComponentProps } from 'react'
import { Pressable, View } from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import { colors } from '@/constants/theme'
import { GLASS_BUTTON_SIZE } from './GlassButton'
import { HeroGlass, useHeroInk } from './HeroGlass'

export interface GlassSwitchOption<T extends string> {
  value: T
  icon: ComponentProps<typeof Ionicons>['name']
  /** Read aloud in place of the icon. */
  label: string
}

/** The inset of the selected segment inside the capsule. */
const INSET = 4
const SEGMENT = GLASS_BUTTON_SIZE - INSET * 2

/**
 * A segmented switch for Home's top section, made to sit beside its glass buttons: a capsule of the
 * same glass and height (HeroGlass), each option an icon in a round segment, the chosen one a solid
 * brand-teal disc with a white icon. The selected state needs 3:1 against the track to pass WCAG's
 * non-text contrast; a white disc on a light track was about 1.1:1, the teal disc clears 4:1. Home uses it for its Summary/Charts switch.
 */
export function GlassSwitch<T extends string>({
  options,
  value,
  onChange,
}: {
  options: Array<GlassSwitchOption<T>>
  value: T
  onChange: (value: T) => void
}) {
  const ink = useHeroInk()
  return (
    <HeroGlass
      style={{
        height: GLASS_BUTTON_SIZE,
        borderRadius: GLASS_BUTTON_SIZE / 2,
        paddingHorizontal: INSET,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 2,
      }}
    >
      {options.map((option) => {
        const selected = option.value === value
        return (
          <Pressable
            key={option.value}
            onPress={() => onChange(option.value)}
            hitSlop={4}
            accessibilityRole="button"
            accessibilityLabel={option.label}
            accessibilityState={{ selected }}
          >
            <View
              style={{
                width: SEGMENT,
                height: SEGMENT,
                borderRadius: SEGMENT / 2,
                alignItems: 'center',
                justifyContent: 'center',
                backgroundColor: selected ? colors.primary : 'transparent',
              }}
            >
              <Ionicons name={option.icon} size={16} color={selected ? colors.textInverse : ink} />
            </View>
          </Pressable>
        )
      })}
    </HeroGlass>
  )
}
