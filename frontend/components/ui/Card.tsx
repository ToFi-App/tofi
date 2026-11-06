import type { ReactNode } from 'react'
import { Pressable, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native'
import { BlurView } from 'expo-blur'
import { borderRadius, colors, shadow, sheetBackdrop } from '@/constants/theme'

/**
 * A card in Home's content layer, on iOS's standard regular material (systemMaterialLight, through
 * expo-blur) — the same on every iOS version — with a hairline rim and a soft shadow lifting it off
 * the mint sheet. Home's sheet puts each of its groups — money in and out, Budget, Spending — on one
 * of these, which is what separates them instead of rules between bare sections.
 *
 * Apple's Human Interface Guidelines keep Liquid Glass to the navigation layer — controls and bars
 * floating above content — and say not to use it in the content layer, where standard materials
 * belong instead. They also say to pick a material by its role, not by the colour it gives, so
 * there's no custom wash over it: the regular material is the default, thick enough for the figures
 * on these cards to stay crisp while the mint still reads through.
 *
 * With `onPress` it is the tap target itself, so a card that leads somewhere is one Pressable.
 */
export function Card({
  children,
  onPress,
  accessibilityLabel,
  radius = borderRadius.lg,
  style,
}: {
  children: ReactNode
  onPress?: () => void
  accessibilityLabel?: string
  radius?: number
  style?: StyleProp<ViewStyle>
}) {
  // Behind the card's content, clipped to its corners. On the tinted mint sheet, the standard
  // material, so the colour reads through; on a white sheet there's nothing for a material to show,
  // so a plain solid white card with a light grey rim, set off by its shadow.
  const backing = !sheetBackdrop.tinted ? (
    <View
      style={[
        StyleSheet.absoluteFill,
        { borderRadius: radius, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.borderCard },
      ]}
    />
  ) : (
    <BlurView
      intensity={100}
      tint="systemMaterialLight"
      style={[
        StyleSheet.absoluteFill,
        { borderRadius: radius, overflow: 'hidden', borderWidth: StyleSheet.hairlineWidth, borderColor: colors.frostCardBorder },
      ]}
    />
  )

  // The shadow goes on an outer view that doesn't clip: a clipped view (the material) can't cast one.
  const surface = (extra?: StyleProp<ViewStyle>) => (
    <View style={[{ borderRadius: radius, ...shadow.lift }, style, extra]}>
      {backing}
      {children}
    </View>
  )

  if (!onPress) return surface()
  // The frame goes on a view inside the Pressable, not on the Pressable's own style: NativeWind wraps
  // Pressable, and a style given as a function of `pressed` is dropped there — the card lost its
  // fill, rim, padding and size.
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={accessibilityLabel}>
      {({ pressed }) => surface(pressed ? { opacity: 0.85 } : undefined)}
    </Pressable>
  )
}
