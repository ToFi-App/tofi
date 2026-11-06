import type { ReactNode } from 'react'
import { View, type StyleProp, type ViewStyle } from 'react-native'
import { GlassView, isLiquidGlassAvailable } from 'expo-glass-effect'
import { colors } from '@/constants/theme'

/** Fixed for the life of the process: it depends on the OS and the SDK the binary was built with. */
const HAS_LIQUID_GLASS = isLiquidGlassAvailable()

/**
 * The glass for controls on Home's top section — the header's two buttons and the month pill: the
 * system's Liquid Glass where iOS has it (iOS 26 and later), shaped by the style's border radius;
 * elsewhere a milky white stand-in with a bright rim, so iOS 17 and 18 get the same shape.
 *
 * Controls only. Apple's guidelines keep Liquid Glass to the navigation layer — controls floating
 * above content — and ask for it sparingly, on the most important functional elements; content
 * (cards, the comparison pill) uses standard materials or plain fills instead. Always the regular
 * variant: clear glass is only for controls over visually rich backgrounds like photos.
 *
 * `interactive` lets the system glass react to touch (the press shimmer) on buttons.
 */
export function HeroGlass({
  children,
  style,
  interactive = false,
}: {
  children: ReactNode
  style?: StyleProp<ViewStyle>
  interactive?: boolean
}) {
  if (HAS_LIQUID_GLASS) {
    return (
      <GlassView glassEffectStyle="regular" isInteractive={interactive} colorScheme="light" style={style}>
        {children}
      </GlassView>
    )
  }
  return <View style={[{ backgroundColor: colors.glass, borderWidth: 1, borderColor: colors.glassBorder }, style]}>{children}</View>
}
