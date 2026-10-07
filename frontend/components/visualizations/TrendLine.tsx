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
const RIPPLE_FROM = 4
const RIPPLE_TO = 16

/**
 * The latest point, marked as live: a solid dot with a ring rippling out of it and fading, on a
 * loop. Animated on the UI thread through animated props, so the ripple never re-renders the
 * chart. With Reduce Motion on it holds still as a plain halo.
 */
export const LiveDot = memo(function LiveDot({ x, y, color }: { x: number; y: number; color: string }) {
  const reduceMotion = useReducedMotion()
  const progress = useSharedValue(0)
  useEffect(() => {
    if (reduceMotion) return
    progress.value = 0
    progress.value = withRepeat(withTiming(1, { duration: RIPPLE_MS, easing: Easing.out(Easing.quad) }), -1, false)
  }, [reduceMotion, progress])
  const ripple = useAnimatedProps(() => ({
    r: RIPPLE_FROM + (RIPPLE_TO - RIPPLE_FROM) * progress.value,
    opacity: 0.45 * (1 - progress.value),
  }))

  return (
    <G>
      {reduceMotion ? (
        <Circle cx={x} cy={y} r={8} fill={hexToRgba(color, 0.18)} />
      ) : (
        <AnimatedCircle cx={x} cy={y} fill={color} animatedProps={ripple} />
      )}
      <Circle cx={x} cy={y} r={3.5} fill={color} />
    </G>
  )
})
