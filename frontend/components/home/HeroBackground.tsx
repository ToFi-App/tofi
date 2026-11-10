import { StyleSheet, View } from 'react-native'
import { LinearGradient } from 'expo-linear-gradient'
import { heroGradient, hexToRgba } from '@/constants/theme'

/** How much colour each pool brings in at its corner — the fuller sky and lemon the section had before,
 *  so the pale mint reads as a soft mesh of colour rather than a flat wash. */
const POOL_STRENGTH = 0.45

/**
 * The backdrop behind Home's top section: a pale mint fading to white with faint pools of other colour drifting into it — sky from the bottom-left, lemon
 * from the bottom-right. All drawn natively by expo-linear-gradient.
 *
 * Each pool runs diagonally up from its corner and is gone by half way. iOS lays a diagonal gradient
 * out in the view's real proportions, and on this short, wide section anything longer reached faintly
 * into the top corners, where the section meets the status-bar band.
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
        locations={[0, 0.6]}
        start={{ x: 0, y: 1 }}
        end={{ x: 0.6, y: 0.2 }}
        style={StyleSheet.absoluteFill}
      />
      <LinearGradient
        colors={[hexToRgba(heroGradient.pools.lemon, POOL_STRENGTH), hexToRgba(heroGradient.pools.lemon, 0)]}
        locations={[0, 0.6]}
        start={{ x: 1, y: 1 }}
        end={{ x: 0.4, y: 0.2 }}
        style={StyleSheet.absoluteFill}
      />
    </View>
  )
}
