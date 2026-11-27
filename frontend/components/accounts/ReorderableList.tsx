import { useMemo, useRef, useState } from 'react'
import { PanResponder, View } from 'react-native'
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated'
import type { ReactNode } from 'react'
import { colors } from '@/constants/theme'
import { targetForOffset } from '@/lib/accounts/order'
import { haptics } from '@/lib/ui/haptics'

/** How long a press must be held before the row lifts. Matches the iOS drag idiom. */
const LIFT_DELAY_MS = 250
/** Movement past this cancels a tap and starts moving the lifted row. */
const DRAG_THRESHOLD = 2
const SHIFT_DURATION_MS = 140

/** Spread onto the row's own Pressable to make it draggable. */
export interface DragHandlers {
  onLongPress: () => void
  onPressOut: () => void
  delayLongPress: number
}

interface ReorderableListProps<T> {
  items: T[]
  keyExtractor: (item: T) => string
  /**
   * Rendered inside the draggable wrapper. `handlers` MUST be spread onto whatever Pressable
   * the row already uses for its tap — this list deliberately renders no Pressable of its
   * own, because a wrapping one never receives the touch (the inner row Pressable wins the
   * responder on touch start, so the long-press would never fire).
   */
  renderItem: (item: T, state: { isLifted: boolean; handlers: DragHandlers }) => ReactNode
  /** Called on drop with the reordered array. Not called when the position is unchanged. */
  onReorder: (items: T[]) => void
  /** Lets the screen freeze its ScrollView while a row is in the air. */
  onDragStateChange?: (isDragging: boolean) => void
}

/**
 * Long-press-then-drag reordering, built on RN's own PanResponder rather than
 * react-native-gesture-handler — which is not a dependency here, and which would make this
 * a native module change (rebuild + App Store review) instead of an OTA-able JS one.
 *
 * The gesture has to coexist with two others already on these rows: a tap that opens the
 * account sheet, and the page's vertical scroll. Long-press arming is what separates all
 * three. A press that never reaches LIFT_DELAY_MS is a tap; a drag that starts before the
 * row lifts belongs to the ScrollView; only once armed does this claim the gesture. The
 * claim uses the CAPTURE phase because the row's own Pressable is already the responder by
 * then, and capture is the only way a parent takes a gesture back from its child.
 *
 * Deliberately no auto-scroll at the list edges. Account groups run 2-5 rows and collapse,
 * so a lifted row can always reach its target without the page moving — which removes the
 * fiddliest part of drag-to-reorder for a case that cannot arise here.
 */
export function ReorderableList<T>({
  items,
  keyExtractor,
  renderItem,
  onReorder,
  onDragStateChange,
}: ReorderableListProps<T>) {
  const [liftedIndex, setLiftedIndex] = useState<number | null>(null)
  const [targetIndex, setTargetIndex] = useState<number | null>(null)
  const dragY = useSharedValue(0)

  // Read inside the PanResponder, which is built once and would otherwise close over the
  // state as it was on first render.
  const armedRef = useRef(false)
  // True between grant and release. onPressOut cannot distinguish "the user lifted their
  // finger" from "the PanResponder just took the gesture" — the Pressable is terminated in
  // both cases, with identical state — so the disarm is deferred a tick and cancelled if a
  // pan turns out to be running. Guarded on BOTH sides because the responder system does not
  // promise whether termination or grant fires first.
  const panActiveRef = useRef(false)
  const disarmTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const liftedRef = useRef<number | null>(null)
  const targetRef = useRef<number | null>(null)
  // Per-index, not one shared height: a long account name can wrap and make its row taller,
  // and a single measured height would then drift the drop target further off with every row
  // crossed.
  const heightsRef = useRef<number[]>([])
  const itemsRef = useRef(items)
  itemsRef.current = items

  const endDrag = (commit: boolean) => {
    const from = liftedRef.current
    const to = targetRef.current
    armedRef.current = false
    liftedRef.current = null
    targetRef.current = null
    dragY.value = 0
    setLiftedIndex(null)
    setTargetIndex(null)
    onDragStateChange?.(false)
    // Set down: the firmer lift at pickup gets a lighter answer at the drop.
    if (from != null) haptics.tap()
    if (commit && from != null && to != null && from !== to) {
      const next = [...itemsRef.current]
      const [moved] = next.splice(from, 1)
      next.splice(to, 0, moved)
      onReorder(next)
    }
  }

  const panResponder = useMemo(
    () =>
      PanResponder.create({
        // Capture, not bubble: by the time a finger moves, the row's Pressable owns the
        // gesture, and only a capture-phase claim can take it back.
        onMoveShouldSetPanResponderCapture: (_, gesture) =>
          armedRef.current && Math.abs(gesture.dy) > DRAG_THRESHOLD,
        onPanResponderMove: (_, gesture) => {
          const from = liftedRef.current
          if (from == null) return
          dragY.value = gesture.dy
          const next = targetForOffset(heightsRef.current, from, gesture.dy)
          if (next !== targetRef.current) {
            haptics.select()
            targetRef.current = next
            setTargetIndex(next)
          }
        },
        onPanResponderGrant: () => {
          panActiveRef.current = true
          if (disarmTimer.current) {
            clearTimeout(disarmTimer.current)
            disarmTimer.current = null
          }
        },
        onPanResponderRelease: () => {
          panActiveRef.current = false
          endDrag(true)
        },
        // A terminated gesture (an incoming call, a parent claiming back) must not commit a
        // half-finished move — the row returns to where it started.
        onPanResponderTerminate: () => {
          panActiveRef.current = false
          endDrag(false)
        },
        onPanResponderTerminationRequest: () => false,
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  )

  return (
    <View {...panResponder.panHandlers}>
      {items.map((item, index) => {
        const handlers: DragHandlers = {
          delayLongPress: LIFT_DELAY_MS,
          onLongPress: () => {
            haptics.lift()
            armedRef.current = true
            liftedRef.current = index
            targetRef.current = index
            setLiftedIndex(index)
            setTargetIndex(index)
            onDragStateChange?.(true)
          },
          onPressOut: () => {
            // Deferred, never immediate: this also fires when the pan claims the gesture, and
            // at that instant the drag state is indistinguishable from an un-dragged press.
            // A tick later, panActiveRef has the answer.
            if (disarmTimer.current) clearTimeout(disarmTimer.current)
            disarmTimer.current = setTimeout(() => {
              disarmTimer.current = null
              if (!panActiveRef.current && liftedRef.current != null) endDrag(false)
            }, 0)
          },
        }
        return (
          <ReorderableRow
            key={keyExtractor(item)}
            isLifted={index === liftedIndex}
            shift={shiftFor(index, liftedIndex, targetIndex)}
            dragY={dragY}
            liftedHeight={liftedIndex == null ? 0 : heightsRef.current[liftedIndex] ?? 0}
            onMeasure={(h) => {
              heightsRef.current[index] = h
            }}
          >
            {renderItem(item, { isLifted: index === liftedIndex, handlers })}
          </ReorderableRow>
        )
      })}
    </View>
  )
}

/** Which way a row steps aside to open a slot for the lifted one, in row-heights. */
function shiftFor(index: number, liftedIndex: number | null, targetIndex: number | null): number {
  if (liftedIndex == null || targetIndex == null || index === liftedIndex) return 0
  if (liftedIndex < targetIndex && index > liftedIndex && index <= targetIndex) return -1
  if (liftedIndex > targetIndex && index >= targetIndex && index < liftedIndex) return 1
  return 0
}

interface ReorderableRowProps {
  isLifted: boolean
  shift: number
  dragY: { value: number }
  /** Height of the row in the air — the gap the others slide into. */
  liftedHeight: number
  onMeasure: (height: number) => void
  children: ReactNode
}

function ReorderableRow({ isLifted, shift, dragY, liftedHeight, onMeasure, children }: ReorderableRowProps) {
  // liftedHeight is read straight from props rather than mirrored into a shared value. The mirror
  // was assigned during render, which is a side effect on a value the UI thread also reads — the
  // case Reanimated's strict mode warns about. It also bought nothing: this worklet already closes
  // over isLifted and shift, so it is rebuilt whenever any of the three changes.
  const style = useAnimatedStyle(() => ({
    transform: [
      { translateY: isLifted ? dragY.value : withTiming(shift * liftedHeight, { duration: SHIFT_DURATION_MS }) },
      { scale: withTiming(isLifted ? 1.02 : 1, { duration: SHIFT_DURATION_MS }) },
    ],
  }))

  return (
    <Animated.View
      onLayout={(e) => onMeasure(e.nativeEvent.layout.height)}
      style={[
        style,
        // Raised above its neighbours, and shadowed so it reads as picked up rather than
        // simply moved. Applied unanimated — a shadow that fades in lags the lift.
        isLifted
          ? {
              zIndex: 2,
              backgroundColor: colors.surface,
              borderRadius: 10,
              shadowColor: colors.textPrimary,
              shadowOpacity: 0.16,
              shadowRadius: 12,
              shadowOffset: { width: 0, height: 4 },
              elevation: 6,
            }
          : { zIndex: 0 },
      ]}
    >
      {children}
    </Animated.View>
  )
}
