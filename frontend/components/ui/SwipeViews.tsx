import { Children, useEffect, useRef, type ReactNode } from 'react'
import { View, useWindowDimensions } from 'react-native'
import { Gesture, GestureDetector } from 'react-native-gesture-handler'
import Animated, { runOnJS, useAnimatedStyle, useSharedValue, withSpring } from 'react-native-reanimated'

/** How far a finger travels sideways before the pager claims it. Wider than a chart's own pan
 *  (TrendChart claims at 8pt, the spending tile's scrub at 4pt), so a drag on a chart stays the chart's. */
const CLAIM_X = 24
/** Travel toward a page that isn't there that lets go of the drag. */
const RELEASE_X = 10
/** Vertical travel that gives the touch to the page's scroll instead. */
const YIELD_Y = 14
/** A swipe turns the page once it's past this share of the screen, or flicked this fast. */
const TURN_SHARE = 0.3
const TURN_VELOCITY = 500
/** Past the first or last page the pager gives a little, then holds. */
const RUBBER = 0.2
/** Settles without overshooting, carrying on from the finger's speed. */
const SPRING = { damping: 28, stiffness: 240, overshootClamping: true }

interface SwipeViewsProps {
  /** The page showing, in the switch's order. */
  index: number
  onIndexChange: (index: number) => void
  /** Off where something inside owns sideways swipes itself. */
  enabled?: boolean
  /** The pages, side by side; all stay mounted, so the next one is already there to see mid-swipe. */
  children: ReactNode
}

/**
 * A screen whose views sit side by side in a switch at the top (Home's Summary and Charts, Net Worth's
 * Overview and Investments): swiped between as well as tapped, the pages gliding with the finger. Only
 * a clearly sideways drag counts: a vertical one is the page's scroll, and a short sideways one on a
 * chart is the chart's own.
 */
export function SwipeViews({ index, onIndexChange, enabled = true, children }: SwipeViewsProps) {
  const { width } = useWindowDimensions()
  const pages = Children.toArray(children)
  const count = pages.length
  const offset = useSharedValue(-index * width)
  const startOffset = useSharedValue(0)
  // The page a swipe has already glided to, so its index change doesn't start a second slide over it.
  const swipedTo = useRef<number | null>(null)

  // A tap on the switch (or anything else that changes the page) glides there too.
  useEffect(() => {
    if (swipedTo.current === index) {
      swipedTo.current = null
      return
    }
    offset.value = withSpring(-index * width, SPRING)
  }, [index, width, offset])

  function turnTo(next: number) {
    swipedTo.current = next
    onIndexChange(next)
  }

  // Only claims a drag toward a page there is, and lets go of one the other way: on its first page a
  // drag right is left for a pager around it (Charts' first page swipes on back to Home's Summary).
  const canBack = index > 0
  const canForward = index < count - 1
  const pan = Gesture.Pan()
    .enabled(enabled && (canBack || canForward))
    .maxPointers(1)
    .activeOffsetX(canBack && canForward ? [-CLAIM_X, CLAIM_X] : canForward ? -CLAIM_X : CLAIM_X)
    // The way there's no page, it gives up early, before a pager around it would claim the drag.
    .failOffsetX(canBack && canForward ? [-1e4, 1e4] : canForward ? RELEASE_X : -RELEASE_X)
    .failOffsetY([-YIELD_Y, YIELD_Y])
    .onStart(() => {
      startOffset.value = offset.value
    })
    .onUpdate((e) => {
      const min = -(count - 1) * width
      const x = startOffset.value + e.translationX
      offset.value = x > 0 ? x * RUBBER : x < min ? min + (x - min) * RUBBER : x
    })
    .onEnd((e) => {
      const from = Math.round(-startOffset.value / width)
      let to = from
      if (e.translationX < -width * TURN_SHARE || e.velocityX < -TURN_VELOCITY) to = from + 1
      else if (e.translationX > width * TURN_SHARE || e.velocityX > TURN_VELOCITY) to = from - 1
      to = Math.max(0, Math.min(count - 1, to))
      offset.value = withSpring(-to * width, { ...SPRING, velocity: e.velocityX })
      if (to !== from) runOnJS(turnTo)(to)
    })

  const rowStyle = useAnimatedStyle(() => ({ transform: [{ translateX: offset.value }] }))

  return (
    <GestureDetector gesture={pan}>
      <View style={{ flex: 1, overflow: 'hidden' }}>
        <Animated.View style={[{ flex: 1, flexDirection: 'row', width: width * count }, rowStyle]}>
          {pages.map((page, i) => (
            <View key={i} style={{ width, flex: 0 }}>
              {page}
            </View>
          ))}
        </Animated.View>
      </View>
    </GestureDetector>
  )
}
