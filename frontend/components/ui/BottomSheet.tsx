import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { Dimensions, KeyboardAvoidingView, Modal, Platform, Pressable, View } from 'react-native'
import { Gesture, GestureDetector, GestureHandlerRootView } from 'react-native-gesture-handler'
import Animated, { Easing, runOnJS, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { borderRadius, colors } from '@/constants/theme'
import { useHasSheetHost } from '@/components/ui/SheetHost'
import { getHostPresented, removeSheetLayer, setSheetLayer, subscribeHostPresented } from '@/lib/ui/sheetRegistry'
import { DRAG_START_THRESHOLD_PX, shouldDismissOnRelease } from '@/lib/ui/sheetDrag'

const SCREEN_HEIGHT = Dimensions.get('window').height

/** Distinguishes one sheet's layer from another's in the registry. */
let sheetSeq = 0

/** RNGH reports velocity in px/s; the dismiss rule is written in px/ms, as PanResponder had it. */
const MS_PER_S = 1000

/** Past this much horizontal travel the gesture is a swipe, not a sheet drag. */
const HORIZONTAL_SLOP_PX = 20

/**
 * How long the entrance will wait for a presentation callback before starting anyway.
 *
 * A safety net, not a timing knob. The entrance is gated on the Modal reporting itself presented,
 * and a sheet whose callback never arrives would otherwise sit parked offscreen forever behind a
 * full-screen backdrop — invisible, swallowing every touch, which is precisely the freeze this
 * component has been bitten by more than once. Missing the callback must degrade to the old
 * behaviour (an entrance that plays early), never to a wedged app.
 *
 * Set well beyond the ~190ms a real presentation takes, so it never pre-empts one.
 */
const PRESENTATION_DEADLINE_MS = 600

/**
 * Vestigial, pending removal from its 13 call sites.
 *
 * It used to feed the content region's drag-to-dismiss: an onScroll handler wrote the scroll offset
 * to a shared value, and a manually-activated pan decided whether a downward drag meant "dismiss"
 * or "scroll". That negotiation was removed — it made this component responsible for resolving
 * every touch inside the sheet, and three separate paths through it failed to resolve one, each
 * time holding the touch and freezing the entire app (a full-screen Modal leaves input nowhere else
 * to go). Dismissal now comes from the grabber and the backdrop, neither of which arbitrates
 * anything.
 *
 * `scrollProps` is deliberately empty rather than deleted: spreading `{}` is a no-op, so the call
 * sites keep compiling while they are cleaned up separately. Emptying it also removes a JS-thread
 * callback that ran on every scroll frame at scrollEventThrottle 16 and whose value nothing reads.
 */
export function useSheetScroll() {
  return useMemo(() => ({ scrollProps: {} as const }), [])
}

export type SheetScroll = ReturnType<typeof useSheetScroll>

interface BottomSheetProps {
  visible: boolean
  onClose: () => void
  children: React.ReactNode
  topOffset?: number
  /** Accepted and ignored; see useSheetScroll. Removed once the call sites stop passing it. */
  contentScroll?: SheetScroll
  /**
   * A layer painted behind the content, filling the sheet and clipped to its rounded top — for a
   * backdrop a flat colour can't express, like a gradient. The sheet stays white underneath.
   */
  background?: React.ReactNode
  /** The grabber pill's colour. Worth darkening when `background` tints the sheet's top edge. */
  grabberColor?: string
}

export function BottomSheet({
  visible,
  onClose,
  children,
  topOffset,
  contentScroll,
  background,
  grabberColor = colors.border,
}: BottomSheetProps) {
  const hasHost = useHasSheetHost()
  const insets = useSafeAreaInsets()
  const translateY = useSharedValue(SCREEN_HEIGHT)
  const backdropOpacity = useSharedValue(0)
  const [isMounted, setIsMounted] = useState(false)
  /**
   * True from the moment a close begins until the sheet reopens. Read on the UI thread, which is
   * why it is a shared value rather than a ref.
   *
   * It exists because `translateY` has two writers — the close animation and the pan gesture — and
   * the last write wins. A gesture write mid-close cancelled the animation, its callback then
   * reported `finished: false`, and the unmount that was gated on `finished` never ran. `isMounted`
   * stayed true, so a transparent full-screen Modal with a Pressable-covered backdrop stayed
   * mounted and swallowed every touch in the app until it was force-quit.
   */
  const isClosing = useSharedValue(false)

  /**
   * Whether this sheet is actually on screen, and therefore whether an entrance would be seen.
   *
   * Two sources because there are two presentation paths. With a host, the host's one Modal reports
   * through the registry; without one, this component's own Modal reports through onShow below.
   */
  const isHostPresented = useSyncExternalStore(subscribeHostPresented, getHostPresented)
  const [isOwnModalPresented, setIsOwnModalPresented] = useState(false)
  const [hasWaitedForPresentation, setHasWaitedForPresentation] = useState(false)
  const isPresented = (hasHost ? isHostPresented : isOwnModalPresented) || hasWaitedForPresentation

  // Arms the deadline while a mounted sheet is still waiting, and disarms it on close so the next
  // open waits for its own presentation rather than inheriting a flag from the last one.
  useEffect(() => {
    if (!isMounted || !visible) {
      setHasWaitedForPresentation(false)
      return
    }
    const timer = setTimeout(() => setHasWaitedForPresentation(true), PRESENTATION_DEADLINE_MS)
    return () => clearTimeout(timer)
  }, [isMounted, visible])

  // Cleared on UNMOUNT, not on close. onShow fires once per presentation, so a sheet reopened
  // before its close animation finished — the Modal never went away — would never hear it again,
  // and clearing this on `visible` would strand that reopen waiting for the deadline instead.
  useEffect(() => {
    if (!isMounted) setIsOwnModalPresented(false)
  }, [isMounted])

  const sheetTop = topOffset ?? insets.top + 60

  const layerId = useRef<string>(`sheet-${(sheetSeq += 1)}`)

  const onCloseRef = useRef(onClose)
  // In an effect rather than assigned during render: a render-phase write is a side effect, and
  // under StrictMode's double render or a discarded concurrent render it happens for a tree that
  // never commits.
  useEffect(() => {
    onCloseRef.current = onClose
  })
  /** Stable identity for runOnJS — a gesture worklet cannot read a React ref. */
  const requestClose = useCallback(() => onCloseRef.current(), [])

  // Mounting and animating are two effects, deliberately. Doing both at once started the entrance
  // on the UI thread in the same tick that queued the mount — so on any slow mount the sheet was
  // already partway through its 350ms by the time the Modal existed, and appeared halfway up or
  // simply snapped into place. Now the animation begins only once the sheet is actually on screen.
  useEffect(() => {
    if (visible) setIsMounted(true)
  }, [visible])

  useEffect(() => {
    if (!isMounted) return
    if (visible) {
      // Held here until the sheet is genuinely on screen. The 350ms below runs on the UI thread the
      // instant it is queued, so starting it at mount spent the entrance behind an unpresented
      // Modal: measured at 189ms of a 350ms entrance, i.e. the sheet appeared already half-risen and
      // snapped the rest of the way. Nothing is visible while we wait — translateY is parked
      // offscreen and the backdrop is fully transparent.
      if (!isPresented) return
      // Cleared BEFORE translateY is touched: writing translateY cancels any close still in
      // flight, and that cancellation's callback must see a sheet that is no longer closing so it
      // does not unmount the reopening sheet.
      isClosing.value = false
      // Explicit, not assumed: an interrupted close (or a drag released mid-flight) can leave
      // translateY anywhere, and animating from there would play a partial entrance.
      translateY.value = SCREEN_HEIGHT
      translateY.value = withTiming(0, { duration: 350, easing: Easing.out(Easing.cubic) })
      backdropOpacity.value = withTiming(1, { duration: 300 })
    } else {
      isClosing.value = true
      translateY.value = withTiming(SCREEN_HEIGHT, { duration: 300, easing: Easing.in(Easing.cubic) }, () => {
        // Deliberately NOT gated on `finished`. Whether the animation ran to completion or was
        // cancelled, the sheet is meant to be gone — the only question is whether it has since
        // reopened, which isClosing answers. Gating on `finished` is what left the Modal mounted.
        if (isClosing.value) runOnJS(setIsMounted)(false)
      })
      backdropOpacity.value = withTiming(0, { duration: 250 })
    }
  }, [visible, isMounted, isPresented, translateY, backdropOpacity, isClosing])

  // Gesture-handler rather than PanResponder: under the New Architecture the JS responder system
  // never runs its *move* negotiation for a view that declined the touch on start, so
  // onMoveShouldSetPanResponder was simply never called and drag-to-dismiss could not work at all.
  // Verified by instrumentation — raw touch events arrived, the negotiation did not. RNGH sits on
  // the native recognizers instead, and its pan runs as a worklet, so dragging no longer round
  // trips through JS on every frame.
  /** Drag the sheet with the finger, fading the backdrop as it goes. */
  const trackFinger = useCallback(
    (translationY: number) => {
      'worklet'
      // A close in progress is authoritative: the finger must not cancel the close animation, which
      // is what used to strand the Modal mounted and offscreen.
      if (isClosing.value) return
      if (translationY <= 0) return
      translateY.value = translationY
      backdropOpacity.value = Math.max(0, 1 - translationY / (SCREEN_HEIGHT * 0.5))
    },
    [translateY, backdropOpacity, isClosing],
  )

  /** Dismiss, or spring back to open. */
  const settle = useCallback(
    (translationY: number, velocityY: number) => {
      'worklet'
      if (isClosing.value) return
      if (shouldDismissOnRelease({ dy: translationY, vy: velocityY / MS_PER_S })) {
        // Hand off to the `visible` effect, which animates from wherever the finger left the sheet
        // down to offscreen and then unmounts it.
        runOnJS(requestClose)()
        return
      }
      translateY.value = withTiming(0, { duration: 200, easing: Easing.out(Easing.cubic) })
      backdropOpacity.value = withTiming(1, { duration: 200 })
    },
    [translateY, backdropOpacity, requestClose, isClosing],
  )

  /**
   * The grabber's gesture, and the only one this component installs.
   *
   * Nothing under it can scroll, so it activates on any downward drag and needs no negotiation —
   * which is exactly why it never had the failure mode the content gesture did. No manualActivation,
   * no offset heuristic, nothing to leave a touch unresolved.
   */
  const grabberGesture = useMemo(
    () =>
      Gesture.Pan()
        .activeOffsetY(DRAG_START_THRESHOLD_PX)
        .failOffsetX([-HORIZONTAL_SLOP_PX, HORIZONTAL_SLOP_PX])
        .onUpdate((event) => trackFinger(event.translationY))
        .onEnd((event) => settle(event.translationY, event.velocityY)),
    [trackFinger, settle],
  )

  const sheetStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: translateY.value }],
  }))

  const backdropStyle = useAnimatedStyle(() => ({
    opacity: backdropOpacity.value,
  }))

  const content = isMounted ? (
    <>
      <Animated.View style={[{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.4)' }, backdropStyle]}>
        <Pressable
          style={{ flex: 1 }}
          onPress={onClose}
        />
      </Animated.View>

      <Animated.View
        style={[
          {
            position: 'absolute',
            top: sheetTop,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: colors.surface,
            borderTopLeftRadius: borderRadius.xl,
            borderTopRightRadius: borderRadius.xl,
          },
          sheetStyle,
        ]}
      >
        {background ? (
          <View
            pointerEvents="none"
            style={{
              position: 'absolute',
              top: 0,
              left: 0,
              right: 0,
              bottom: 0,
              overflow: 'hidden',
              borderTopLeftRadius: borderRadius.xl,
              borderTopRightRadius: borderRadius.xl,
            }}
          >
            {background}
          </View>
        ) : null}
        {/* The sheet is pinned to the bottom of the screen, so an open keyboard sits on top of
            its lowest fields — the note input on the transaction form, for one. Shrinking the
            sheet by the keyboard's overlap keeps every field inside a scrollable, visible area.
            Android resizes the window itself, where 'height' measures no overlap and no-ops. */}
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
          <GestureDetector gesture={grabberGesture}>
            {/* Full-width strip, not just the 40px pill: the whole band above the content reads
                as the grab area, and a target the width of the sheet is what makes the gesture
                findable. */}
            <View className="items-center pt-3 pb-3">
              <View className="h-1 w-10 rounded-full" style={{ backgroundColor: grabberColor }} />
            </View>
          </GestureDetector>
          {/* No GestureDetector over the content: nothing arbitrates its touches, so taps, scrolls
              and text input reach it untouched. The grabber is the dismiss affordance. */}
          <View style={{ flex: 1 }}>{children}</View>
        </KeyboardAvoidingView>
      </Animated.View>
    </>
  ) : null

  /**
   * Published on every render, deliberately: `content` closes over children that change identity
   * each time, so the host needs the current tree rather than the one from first mount. Writing to
   * the registry re-renders only the host, never this component's ancestors, so this cannot loop.
   */
  useEffect(() => {
    if (!hasHost) return
    if (content === null) removeSheetLayer(layerId.current)
    else setSheetLayer(layerId.current, content)
  })

  // Unmounting mid-animation would otherwise strand the layer, and with it a full-screen backdrop.
  useEffect(() => {
    const id = layerId.current
    return () => removeSheetLayer(id)
  }, [])

  // With a host, this component renders nothing in place — its tree lives in the host's Modal.
  // Both returns below are the ONLY ones in this component, and they must stay last: every hook
  // above them runs on every render. An early return before the layer effects made the hook count
  // change with `isMounted`, which React reports as "Rendered more hooks than during the previous
  // render" and which unmounts the tree the moment a sheet opens.
  if (hasHost) return null

  if (!isMounted) return null

  return (
    <Modal
      transparent
      visible={isMounted}
      statusBarTranslucent
      onRequestClose={onClose}
      onShow={() => setIsOwnModalPresented(true)}
    >
      {/* Required INSIDE the Modal: RN mounts modal content in its own native view hierarchy, which
          sits outside any root-level gesture handler, so gestures registered here would never be
          recognized without a root of their own. */}
      <GestureHandlerRootView style={{ flex: 1 }}>{content}</GestureHandlerRootView>
    </Modal>
  )
}
