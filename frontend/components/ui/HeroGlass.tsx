import { createContext, useContext, type ReactNode } from 'react'
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native'
import { BlurView } from 'expo-blur'
import { colors, heroGradient, shadow } from '@/constants/theme'

/**
 * The surface for controls on Home's top section — the Summary/Charts switch, the month pill and the
 * header's buttons: iOS's standard thin material (through expo-blur, light or dark to suit the
 * section's ink — FROST) under a veil with a soft rim, shaped by the style's border radius — the same on every iOS.
 *
 * Not Liquid Glass, deliberately: the system glass casts its own soft shadow, which iOS doesn't let
 * an app tone down, and on the light mint it made the buttons stand out more than the figure they
 * frame. The thin material reads as frosted without that lift.
 *
 * `interactive` is kept for callers that pass it; the material has no press effect of its own (the
 * pressed opacity the callers apply does that job).
 */
/**
 * What the controls sit on: the mint top section ('tinted', the default) or a plain white page
 * ('plain': Home's Charts view, Calendar). On plain, a frost or a white fill would vanish into the
 * page, so the controls take iOS's neutral control fill (controlFill) instead.
 */
export const HeroSurfaceContext = createContext<'tinted' | 'plain'>('tinted')

/**
 * The ink for a header control's glyph or text: the top section's own ink (heroGradient.ink, white
 * over the deep teal) on the tinted surface, the app's dark text on a plain page's tinted controls.
 */
export function useHeroInk(): string {
  return useContext(HeroSurfaceContext) === 'plain' ? colors.textPrimary : heroGradient.ink
}

/** Whether the top section takes white ink — then its controls are frosted dark, not light. */
const ON_DARK_HERO = heroGradient.ink === colors.textInverse

/**
 * The frost over the tinted top section, matched to its ink. Under black ink, a light material and a
 * white veil. Under white ink a light frost would wash the white glyphs out, so the material is the
 * dark thin one with only a faint white veil and rim — the glyphs keep their contrast.
 */
const FROST = ON_DARK_HERO
  ? { tint: 'systemThinMaterialDark' as const, veil: 'rgba(255,255,255,0.08)', rim: 'rgba(255,255,255,0.22)' }
  : null

/** The controls' and pills' look on a pale top section: solid white, lifted off the near-white wash by
 *  a soft shadow (shadow.chip). The switch's teal selected disc is about 5.4:1 against the white. */
export const PALE_HERO_CHIP = { backgroundColor: colors.surface, ...shadow.chip }

export function HeroGlass({
  children,
  style,
}: {
  children: ReactNode
  style?: StyleProp<ViewStyle>
  interactive?: boolean
}) {
  const surface = useContext(HeroSurfaceContext)
  if (surface === 'plain') {
    return <View style={[{ backgroundColor: colors.controlFill }, style]}>{children}</View>
  }
  // On a pale top section the controls are white chips with a soft shadow (PALE_HERO_CHIP).
  if (!FROST) {
    return <View style={[PALE_HERO_CHIP, style]}>{children}</View>
  }
  const radius = StyleSheet.flatten(style)?.borderRadius
  return (
    <View style={[{ borderWidth: 1, borderColor: FROST.rim, overflow: 'hidden' }, style]}>
      {/* The material, then the veil over it, both behind the content. */}
      <BlurView intensity={100} tint={FROST.tint} style={[StyleSheet.absoluteFill, { borderRadius: radius }]} />
      <View style={[StyleSheet.absoluteFill, { backgroundColor: FROST.veil }]} />
      {children}
    </View>
  )
}
