import { useState } from 'react'
import { StyleSheet, View, type ViewStyle } from 'react-native'
import Animated, { type AnimatedStyle } from 'react-native-reanimated'
import { LinearGradient } from 'expo-linear-gradient'
import Svg, { Defs, RadialGradient, Rect, Stop } from 'react-native-svg'
import { colors, pageBackdrop } from '@/constants/theme'

/**
 * The app's page backdrop (pageBackdrop): a near-white with the faintest breath of mint, and soft
 * pools of other colour drifting through it — sky down the left, lemon and lilac lower on the right —
 * so a page reads as a gentle mesh of light rather than flat white. Reusable on any screen: lay it
 * first inside the screen's root, and it fills it.
 *
 * Home's sheet passes `variant="sheet"` (a step fainter), `radius` (its rounded top corners, carried here because clipping the sheet
 * itself would clip its shadow too) and `rim` (a bright line along that top edge, where the sheet
 * meets the top section). A plain page passes neither.
 *
 * The pools are placed by distance from the top, not by the page's height, so they sit around the
 * content of the first screen however long the page runs. They need the backdrop's measured size:
 * react-native-svg on the new architecture doesn't redraw percentage sizes when the parent resizes,
 * so it measures itself and keys the drawing on it.
 */
export function PageBackdrop({
  radius = 0,
  rim = false,
  variant = 'page',
  cornerStyle,
}: {
  radius?: number
  rim?: boolean
  /** Animated top corners, overriding `radius` — Home's sheet, whose corners square off on collapse. */
  cornerStyle?: AnimatedStyle<ViewStyle>
  /** 'sheet' is Home's sheet, a step fainter; 'page' everywhere else. */
  variant?: 'page' | 'sheet'
}) {
  const [size, setSize] = useState({ width: 0, height: 0 })
  const tone = variant === 'sheet' ? pageBackdrop.sheet : pageBackdrop
  const { width, height } = size

  const pools = [
    // Kept off the top edge: on Home the top section has its own lemon pool just above the sheet, and
    // the two meeting there blurred where one ends and the other begins.
    { id: 'lemon', color: pageBackdrop.blooms.lemon, cx: width * 0.9, cy: 300, r: width * 0.7 },
    { id: 'sky', color: pageBackdrop.blooms.sky, cx: width * 0.02, cy: 380, r: width * 0.8 },
    { id: 'lilac', color: pageBackdrop.blooms.lilac, cx: width * 0.95, cy: 760, r: width * 0.85 },
  ]

  return (
    <Animated.View
      pointerEvents="none"
      onLayout={(e) => setSize({ width: e.nativeEvent.layout.width, height: e.nativeEvent.layout.height })}
      style={[
        StyleSheet.absoluteFill,
        { borderTopLeftRadius: radius, borderTopRightRadius: radius, overflow: 'hidden' },
        rim ? { borderTopWidth: 1.5, borderColor: colors.frostCardBorder } : null,
        cornerStyle,
      ]}
    >
      <LinearGradient
        colors={tone.stops}
        locations={[0, 0.4, 1]}
        start={{ x: 0, y: 0 }}
        end={{ x: 0, y: 1 }}
        style={StyleSheet.absoluteFill}
      />
      {width > 0 && height > 0 ? (
        <Svg key={`${width}x${height}`} width={width} height={height} style={StyleSheet.absoluteFill}>
          <Defs>
            {pools.map((pool) => (
              <RadialGradient key={pool.id} id={`page-${pool.id}`} cx={pool.cx} cy={pool.cy} r={pool.r} gradientUnits="userSpaceOnUse">
                <Stop offset="0" stopColor={pool.color} stopOpacity={tone.bloomStrength} />
                <Stop offset="0.55" stopColor={pool.color} stopOpacity={tone.bloomStrength * 0.35} />
                <Stop offset="1" stopColor={pool.color} stopOpacity={0} />
              </RadialGradient>
            ))}
          </Defs>
          {pools.map((pool) => (
            <Rect key={pool.id} x="0" y="0" width={width} height={height} fill={`url(#page-${pool.id})`} />
          ))}
        </Svg>
      ) : null}
    </Animated.View>
  )
}
