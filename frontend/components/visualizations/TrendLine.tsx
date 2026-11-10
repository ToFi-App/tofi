import { memo, useEffect } from 'react'
import Animated, {
  Easing,
  useAnimatedProps,
  useReducedMotion,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated'
import { Circle, Defs, G, LinearGradient, Path, Stop } from 'react-native-svg'
import { hexToRgba } from '@/constants/theme'

/** A trend line and the fading area under it. `gradientId` must be unique among mounted charts. */
export const LineLayer = memo(function LineLayer({
  gradientId,
  areaPath,
  linePath,
  lineColor,
}: {
  gradientId: string
  areaPath: string
  linePath: string
  lineColor: string
}) {
  return (
    <G>
      <Defs>
        <LinearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0" stopColor={lineColor} stopOpacity={0.2} />
          <Stop offset="1" stopColor={lineColor} stopOpacity={0} />
        </LinearGradient>
      </Defs>
      {areaPath ? <Path d={areaPath} fill={`url(#${gradientId})`} /> : null}
      {linePath ? (
        <Path d={linePath} stroke={lineColor} strokeWidth={1.5} fill="none" strokeLinejoin="round" strokeLinecap="round" />
      ) : null}
    </G>
  )
})

const AnimatedCircle = Animated.createAnimatedComponent(Circle)

/** One ripple's length; the ring grows and fades over this, then starts again. */
const RIPPLE_MS = 1800
/** The dot's radius on a chart line; the ripple starts just outside it and grows to this many times it. */
const DOT_RADIUS = 3.5
const RIPPLE_REACH = 16 / DOT_RADIUS

/**
 * The latest point, marked as live: a solid dot with a ring rippling out of it and fading, on a
 * loop. Animated on the UI thread through animated props, so the ripple never re-renders the
 * chart. With Reduce Motion on it holds still as a plain halo.
 *
 * `radius` scales the dot and its ripple together (the chart's 3.5 by default); `outline` rings the
 * dot in a colour of its own, for a dot sitting on a fill of its own colour — the budget bar's knob.
 */
export const LiveDot = memo(function LiveDot({
  x,
  y,
  color,
  radius = DOT_RADIUS,
  outline,
  reach = RIPPLE_REACH,
  strength = 0.45,
}: {
  x: number
  y: number
  color: string
  radius?: number
  outline?: string
  /** How far the ripple spreads, as a multiple of the dot's radius. */
  reach?: number
  /** How strong the ripple is as it leaves the dot, 0–1. */
  strength?: number
}) {
  const rippleFrom = radius + 0.5
  const rippleTo = radius * reach
  const reduceMotion = useReducedMotion()
  const progress = useSharedValue(0)
  useEffect(() => {
    if (reduceMotion) return
    progress.value = 0
    progress.value = withRepeat(withTiming(1, { duration: RIPPLE_MS, easing: Easing.out(Easing.quad) }), -1, false)
  }, [reduceMotion, progress])
  const ripple = useAnimatedProps(() => ({
    r: rippleFrom + (rippleTo - rippleFrom) * progress.value,
    opacity: strength * (1 - progress.value),
  }))

  return (
    <G>
      {reduceMotion ? (
        <Circle cx={x} cy={y} r={radius * 2.3} fill={hexToRgba(color, 0.18)} />
      ) : (
        <AnimatedCircle cx={x} cy={y} fill={color} animatedProps={ripple} />
      )}
      <Circle cx={x} cy={y} r={radius} fill={color} stroke={outline} strokeWidth={outline ? 2 : 0} />
    </G>
  )
})
