import type { ReactNode } from 'react'
import { Gesture, GestureDetector } from 'react-native-gesture-handler'
import Animated, { useAnimatedStyle, useSharedValue, withSpring } from 'react-native-reanimated'

/** How far a finger travels sideways before the swipe claims it. Wider than a chart's own pan
 *  (TrendChart claims at 8pt, the spending tile's scrub at 4pt), so a drag on a chart stays the chart's. */
const CLAIM_X = 24
/** Vertical travel that gives the touch to the page's scroll instead. */
const YIELD_Y = 14
/** A swipe switches once it has travelled this far, or been flicked this fast. */
const SWITCH_DISTANCE = 64
const SWITCH_VELOCITY = 600
/** The content leans after the finger a little, so the swipe reads as moving the page. */
const FOLLOW = 0.25
const MAX_LEAN = 32

interface SwipeViewsProps {
  /** A swipe toward the left: the view to the right of this one in the switch. */
  onSwipeLeft?: () => void
  /** A swipe toward the right: the view to the left. */
  onSwipeRight?: () => void
  children: ReactNode
}

/**
 * A screen whose views sit side by side in a switch at the top (Home's Summary and Charts, Net Worth's
 * Overview and Investments) — swiped between as well as tapped. Only a clearly sideways drag counts: a
 * vertical one is the page's scroll, and a short sideways one on a chart is the chart's own.
 */
export function SwipeViews({ onSwipeLeft, onSwipeRight, children }: SwipeViewsProps) {
  const lean = useSharedValue(0)

  const swipe = Gesture.Pan()
    .maxPointers(1)
    .activeOffsetX([-CLAIM_X, CLAIM_X])
    .failOffsetY([-YIELD_Y, YIELD_Y])
    .onUpdate((e) => {
      // Only toward a view there is to go to; the other way stays put.
      const toward = e.translationX < 0 ? onSwipeLeft : onSwipeRight
      lean.value = toward ? Math.max(-MAX_LEAN, Math.min(MAX_LEAN, e.translationX * FOLLOW)) : 0
    })
    .onEnd((e) => {
      const isFar = Math.abs(e.translationX) > SWITCH_DISTANCE || Math.abs(e.velocityX) > SWITCH_VELOCITY
      // A flick back the other way at the end takes the swipe back.
      const isFlickedBack = Math.sign(e.velocityX) === -Math.sign(e.translationX) && Math.abs(e.velocityX) > SWITCH_VELOCITY
      if (!isFar || isFlickedBack) return
      if (e.translationX < 0) onSwipeLeft?.()
      else onSwipeRight?.()
    })
    .onFinalize(() => {
      lean.value = withSpring(0, { damping: 20, stiffness: 260 })
    })
    // The callbacks switch React state, so they run on the JS thread.
    .runOnJS(true)

  const leanStyle = useAnimatedStyle(() => ({ transform: [{ translateX: lean.value }] }))

  return (
    <GestureDetector gesture={swipe}>
      <Animated.View style={[{ flex: 1 }, leanStyle]}>{children}</Animated.View>
    </GestureDetector>
  )
}
