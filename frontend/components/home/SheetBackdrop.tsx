import { useState } from 'react'
import { StyleSheet, View } from 'react-native'
import { LinearGradient } from 'expo-linear-gradient'
import Svg, { Defs, RadialGradient, Rect, Stop } from 'react-native-svg'
import { colors, sheetBackdrop } from '@/constants/theme'

/** How strong each colour pool is at its centre — faint: it should tint the mint, never show a shape. */
const BLOOM_STRENGTH = 0.45

/**
 * The backdrop under Home's sheet: the sage-mint gradient, with soft pools of other colours drifting
 * through it — sky down the left, lemon and lilac lower on the right — so it reads as a
 * gentle mesh of light, the polish behind the frosted cards.
 *
 * Fills its parent, the sheet, and carries the sheet's rounded top corners itself (clipping the sheet
 * would clip its shadow too). The pools are placed by distance from the top, not by the sheet's
 * height, so they sit around the cards on the first screen however long the sheet runs. They need the
 * backdrop's measured size: react-native-svg on the new architecture doesn't redraw percentage sizes
 * when the parent resizes, so it measures itself and keys the drawing on it.
 */
export function SheetBackdrop({ radius }: { radius: number }) {
  const [size, setSize] = useState({ width: 0, height: 0 })
  const { width, height } = size

  const pools = [
    // Kept off the sheet's top edge: the top section has its own lemon pool just above it, and the
    // two meeting there blurred where one ends and the other begins.
    { id: 'lemon', color: sheetBackdrop.blooms.lemon, cx: width * 0.9, cy: 300, r: width * 0.7 },
    { id: 'sky', color: sheetBackdrop.blooms.sky, cx: width * 0.02, cy: 380, r: width * 0.8 },
    { id: 'lilac', color: sheetBackdrop.blooms.lilac, cx: width * 0.95, cy: 760, r: width * 0.85 },
  ]

  return (
    <View
      pointerEvents="none"
      onLayout={(e) => setSize({ width: e.nativeEvent.layout.width, height: e.nativeEvent.layout.height })}
      style={[
        StyleSheet.absoluteFill,
        {
          borderTopLeftRadius: radius,
          borderTopRightRadius: radius,
          overflow: 'hidden',
          // A bright rim along the top edge, light catching the sheet's lip — the line that says where
          // the top section ends and the sheet begins.
          borderTopWidth: 1.5,
          borderColor: colors.frostCardBorder,
        },
      ]}
    >
      <LinearGradient
        colors={sheetBackdrop.stops}
        locations={[0, 0.4, 1]}
        start={{ x: 0, y: 0 }}
        end={{ x: 0, y: 1 }}
        style={StyleSheet.absoluteFill}
      />
      {sheetBackdrop.tinted && width > 0 && height > 0 ? (
        <Svg key={`${width}x${height}`} width={width} height={height} style={StyleSheet.absoluteFill}>
          <Defs>
            {pools.map((pool) => (
              <RadialGradient key={pool.id} id={`sheet-${pool.id}`} cx={pool.cx} cy={pool.cy} r={pool.r} gradientUnits="userSpaceOnUse">
                <Stop offset="0" stopColor={pool.color} stopOpacity={BLOOM_STRENGTH} />
                <Stop offset="0.55" stopColor={pool.color} stopOpacity={BLOOM_STRENGTH * 0.35} />
                <Stop offset="1" stopColor={pool.color} stopOpacity={0} />
              </RadialGradient>
            ))}
          </Defs>
          {pools.map((pool) => (
            <Rect key={pool.id} x="0" y="0" width={width} height={height} fill={`url(#sheet-${pool.id})`} />
          ))}
        </Svg>
      ) : null}
    </View>
  )
}
