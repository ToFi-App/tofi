import { StyleSheet, View } from 'react-native'
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg'
import { colors, hexToRgba } from '@/constants/theme'
import { blendStops, type DayHeat, type DaySquare } from '@/lib/transactions/daySquares'

// Shade range: faint enough at the top that the date and amount stay readable on it. The category
// blend runs a touch stronger than a flat tint, since its colours share the cell between them.
const HEAT_MIN = 0.04
const HEAT_MAX = 0.2
const BLEND_MIN = 0.15
const BLEND_MAX = 0.4

/**
 * A day's heat shade, filling its parent (which should clip it: overflow hidden, rounded). GitHub-
 * activity style, stronger the bigger the day: a net income day is a flat green; a net spending day
 * blends its categories' colours diagonally, in proportion (see blendStops). The calendar grid's
 * cells and the collapsed day strip both draw it, so a day looks the same in either.
 */
export function DayShade({ id, squares, heat }: { id: string; squares: DaySquare[]; heat: DayHeat }) {
  if (heat.intensity <= 0) return null
  const stops = heat.tone === 'expense' ? blendStops(squares) : []
  if (stops.length === 0) {
    const tint = heat.tone === 'income' ? colors.income : colors.expense
    return (
      <View
        pointerEvents="none"
        style={[StyleSheet.absoluteFill, { backgroundColor: hexToRgba(tint, HEAT_MIN + (HEAT_MAX - HEAT_MIN) * heat.intensity) }]}
      />
    )
  }
  const opacity = BLEND_MIN + (BLEND_MAX - BLEND_MIN) * heat.intensity
  return (
    // The wrapper fills the cell; the Svg fills the wrapper. Positioned directly, the Svg sizes
    // itself from its width/height props and ignores the absolute insets, covering only part.
    <View pointerEvents="none" style={StyleSheet.absoluteFill}>
      <Svg width="100%" height="100%">
        <Defs>
          <LinearGradient id={id} x1="0" y1="0" x2="1" y2="1">
            {stops.map((stop, i) => (
              <Stop key={i} offset={stop.offset} stopColor={stop.color} stopOpacity={opacity} />
            ))}
          </LinearGradient>
        </Defs>
        <Rect x="0" y="0" width="100%" height="100%" fill={`url(#${id})`} />
      </Svg>
    </View>
  )
}
