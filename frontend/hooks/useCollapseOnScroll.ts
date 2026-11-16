import { useState } from 'react'
import {
  Extrapolation,
  interpolate,
  runOnJS,
  useAnimatedReaction,
  useAnimatedScrollHandler,
  useAnimatedStyle,
  useSharedValue,
} from 'react-native-reanimated'

/**
 * A top section that scrolls away under a slim bar: the bar fades in over the last 32pt before
 * `collapseAt` (the scroll offset at which the section is gone), and only takes taps once it's in.
 * Home's month bar and the Calendar's day strip both run on this, so the two collapse alike.
 *
 * Pass `onScroll` to an Animated.ScrollView; `scrollY` is there for anything else that follows the
 * scroll. A `collapseAt` of 0 means not measured yet, and keeps the bar hidden.
 */
export function useCollapseOnScroll(collapseAt: number) {
  const scrollY = useSharedValue(0)
  const [isCollapsed, setIsCollapsed] = useState(false)

  const onScroll = useAnimatedScrollHandler((event) => {
    scrollY.value = event.contentOffset.y
  })
  const barStyle = useAnimatedStyle(() => ({
    opacity: collapseAt > 0 ? interpolate(scrollY.value, [collapseAt - 32, collapseAt], [0, 1], Extrapolation.CLAMP) : 0,
  }))
  useAnimatedReaction(
    () => collapseAt > 0 && scrollY.value >= collapseAt - 16,
    (collapsed, previous) => {
      if (collapsed !== previous) runOnJS(setIsCollapsed)(collapsed)
    },
    [collapseAt],
  )

  return { scrollY, onScroll, barStyle, isCollapsed }
}
