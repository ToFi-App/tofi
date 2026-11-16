import type { ReactNode } from 'react'
import type { ViewStyle } from 'react-native'
import Animated, { type AnimatedStyle } from 'react-native-reanimated'

/**
 * The shell of a bar a scrolled-away top section leaves behind (see useCollapseOnScroll): pinned to
 * the top of the screen, faded by `style`, and out of the way of taps while it's faded out. What it
 * shows, and on what colour, is the caller's.
 */
export function CollapsingBar({
  isInteractive,
  style,
  children,
}: {
  /** Off while the bar is faded out, so it never catches a tap meant for the page under it. */
  isInteractive: boolean
  /** The fade, plus the bar's own look: height, colour, padding, layout. */
  style: (AnimatedStyle<ViewStyle> | ViewStyle)[]
  children: ReactNode
}) {
  return (
    <Animated.View
      pointerEvents={isInteractive ? 'auto' : 'none'}
      style={[{ position: 'absolute', top: 0, left: 0, right: 0 }, ...style]}
    >
      {children}
    </Animated.View>
  )
}
