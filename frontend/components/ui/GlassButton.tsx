import type { ReactNode } from 'react'
import { Pressable } from 'react-native'
import { HeroGlass } from './HeroGlass'

/** Matches the month pill between Home's two header buttons, so the row reads as one set. */
export const GLASS_BUTTON_SIZE = 40

/**
 * A round glass button for Home's mint top section: a deep-teal glyph on Liquid Glass (HeroGlass,
 * with its stand-in before iOS 26). Home's header puts its account filter and write button in these,
 * either side of the month.
 */
export function GlassButton({
  onPress,
  accessibilityLabel,
  children,
}: {
  onPress: () => void
  accessibilityLabel: string
  children: ReactNode
}) {
  return (
    <Pressable onPress={onPress} hitSlop={4} accessibilityRole="button" accessibilityLabel={accessibilityLabel}>
      {({ pressed }) => (
        <HeroGlass
          interactive
          style={{
            width: GLASS_BUTTON_SIZE,
            height: GLASS_BUTTON_SIZE,
            borderRadius: GLASS_BUTTON_SIZE / 2,
            alignItems: 'center',
            justifyContent: 'center',
            opacity: pressed ? 0.7 : 1,
          }}
        >
          {children}
        </HeroGlass>
      )}
    </Pressable>
  )
}
