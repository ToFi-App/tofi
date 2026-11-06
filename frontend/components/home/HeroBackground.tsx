import { StyleSheet, View } from 'react-native'
import { LinearGradient } from 'expo-linear-gradient'
import { heroGradient, hexToRgba } from '@/constants/theme'

/** How much colour each pool brings in at its corner — faint, like the sheet's own pools. */
const POOL_STRENGTH = 0.45

/**
 * The backdrop behind Home's top section, in the same family as the sheet's (SheetBackdrop): a soft
 * mint gradient with faint pools of other colour drifting into it — sky from the bottom-left, lemon
 * from the bottom-right. All drawn natively by expo-linear-gradient.
 *
 * Each pool runs diagonally up from its corner and is gone by 70% of the way, which keeps it clear of
 * the whole top edge, where the section meets the flat status-bar band.
 *
 * Fills its parent, the section itself, so it scrolls with the section's contents.
 */
export function HeroBackground() {
  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill}>
      <LinearGradient
        colors={heroGradient.stops}
        locations={[0, 0.5, 1]}
        start={{ x: 0, y: 0 }}
        end={{ x: 0, y: 1 }}
        style={StyleSheet.absoluteFill}
      />
      <LinearGradient
        colors={[hexToRgba(heroGradient.pools.sky, POOL_STRENGTH), hexToRgba(heroGradient.pools.sky, 0)]}
        locations={[0, 0.7]}
        start={{ x: 0, y: 1 }}
        end={{ x: 0.6, y: 0.2 }}
        style={StyleSheet.absoluteFill}
      />
      <LinearGradient
        colors={[hexToRgba(heroGradient.pools.lemon, POOL_STRENGTH), hexToRgba(heroGradient.pools.lemon, 0)]}
        locations={[0, 0.7]}
        start={{ x: 1, y: 1 }}
        end={{ x: 0.4, y: 0.2 }}
        style={StyleSheet.absoluteFill}
      />
    </View>
  )
}
