import { useCallback, useEffect, useMemo, useRef } from 'react'
import { View } from 'react-native'
import { Gesture, GestureDetector } from 'react-native-gesture-handler'
import Animated, { runOnJS, useAnimatedStyle, useSharedValue } from 'react-native-reanimated'
import { colors } from '@/constants/theme'
import { haptics } from '@/lib/ui/haptics'

const THUMB = 28
const TRACK = 4
/** A drag ticks as it crosses each of this many even steps along the track, the ends included. */
const DETENTS = 20

interface RangeSliderProps {
  /** Both ends as positions along the track, 0 to 1. */
  low: number
  high: number
  /** Called as either thumb moves, with both positions. */
  onChange: (low: number, high: number) => void
  accessibilityLabel: string
}

/**
 * Two thumbs on one track, picking a range. Works in positions (0–1) only: what a position means —
 * an amount, on whatever scale — is the caller's business.
 *
 * Each thumb's pan only takes over once the finger has moved sideways, and lets go if it moves up or
 * down first, so a slider inside a scrolling sheet never steals the scroll.
 */
export function RangeSlider({ low, high, onChange, accessibilityLabel }: RangeSliderProps) {
  const width = useSharedValue(0)
  const lowPos = useSharedValue(low)
  const highPos = useSharedValue(high)
  const dragging = useSharedValue(false)
  const startPos = useSharedValue(0)
  // The step the dragged thumb last ticked at, so a drag ticks once per step rather than per frame.
  const lastStep = useSharedValue(-1)
  const tick = useCallback(() => haptics.select(), [])

  // Follow the props while nobody is dragging — a reset, or the sheet reopening.
  useEffect(() => {
    if (dragging.value) return
    lowPos.value = low
    highPos.value = high
  }, [low, high, dragging, lowPos, highPos])

  // Built once: a gesture rebuilt mid-drag (every onChange re-renders the caller) can drop the
  // touch. The latest onChange is reached through a ref instead.
  const onChangeRef = useRef(onChange)
  onChangeRef.current = onChange
  const emit = useCallback((l: number, h: number) => onChangeRef.current(l, h), [])

  const lowGesture = useMemo(() => thumbGesture('low'), [])
  const highGesture = useMemo(() => thumbGesture('high'), [])

  function thumbGesture(which: 'low' | 'high') {
    return Gesture.Pan()
      .activeOffsetX([-3, 3])
      .failOffsetY([-12, 12])
      .onStart(() => {
        dragging.value = true
        startPos.value = which === 'low' ? lowPos.value : highPos.value
        lastStep.value = Math.round(startPos.value * DETENTS)
      })
      .onUpdate((event) => {
        if (width.value <= 0) return
        const next = startPos.value + event.translationX / width.value
        if (which === 'low') lowPos.value = Math.min(Math.max(0, next), highPos.value)
        else highPos.value = Math.max(Math.min(1, next), lowPos.value)
        runOnJS(emit)(lowPos.value, highPos.value)
        const step = Math.round((which === 'low' ? lowPos.value : highPos.value) * DETENTS)
        if (step !== lastStep.value) {
          lastStep.value = step
          runOnJS(tick)()
        }
      })
      .onFinalize(() => {
        dragging.value = false
      })
  }

  const lowThumbStyle = useAnimatedStyle(() => ({ transform: [{ translateX: lowPos.value * width.value }] }))
  const highThumbStyle = useAnimatedStyle(() => ({ transform: [{ translateX: highPos.value * width.value }] }))
  const fillStyle = useAnimatedStyle(() => ({
    left: lowPos.value * width.value,
    width: (highPos.value - lowPos.value) * width.value,
  }))

  const thumb = {
    position: 'absolute' as const,
    left: 0,
    top: 0,
    width: THUMB,
    height: THUMB,
    borderRadius: THUMB / 2,
    borderWidth: 3,
    borderColor: colors.primary,
    backgroundColor: colors.surface,
  }

  return (
    <View
      accessibilityLabel={accessibilityLabel}
      style={{ height: THUMB, paddingHorizontal: THUMB / 2, justifyContent: 'center' }}
    >
      {/* The track runs between the thumbs' centres at either end, so a thumb never hangs past it. */}
      <View
        onLayout={(event) => {
          width.value = event.nativeEvent.layout.width
        }}
        style={{ height: TRACK, borderRadius: TRACK / 2, backgroundColor: colors.border }}
      >
        <Animated.View
          style={[{ position: 'absolute', top: 0, height: TRACK, borderRadius: TRACK / 2, backgroundColor: colors.primary }, fillStyle]}
        />
      </View>
      <View pointerEvents="box-none" style={{ position: 'absolute', left: 0, right: 0, top: 0, bottom: 0 }}>
        <GestureDetector gesture={lowGesture}>
          <Animated.View hitSlop={12} style={[thumb, lowThumbStyle]} />
        </GestureDetector>
        <GestureDetector gesture={highGesture}>
          <Animated.View hitSlop={12} style={[thumb, highThumbStyle]} />
        </GestureDetector>
      </View>
    </View>
  )
}
