import { memo, useCallback, useEffect, useMemo, useRef } from 'react'
import { View, useWindowDimensions } from 'react-native'
import { Gesture, GestureDetector } from 'react-native-gesture-handler'
import Animated, {
  Easing,
  runOnJS,
  useAnimatedProps,
  useReducedMotion,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated'
import Svg, { Circle, Defs, G, Line, LinearGradient, Path, Stop, Text as SvgText } from 'react-native-svg'
import { colors, fontFamily, hexToRgba } from '@/constants/theme'
import { fittedExtent, monotoneLine } from '@/lib/charts/lineChart'
import { formatTrendLabel, type Granularity, type TrendPoint } from '@/lib/accounts/netWorthHistory'

interface NetWorthTrendChartProps {
  /** Net worth per point, for the line — the same points as `accountPoints`. */
  points: { netWorth: number; change: number }[]
  /** Per-account balances per point (day, week or month) — for the x positions and dates, and a
   *  highlighted account's moves. */
  accountPoints: TrendPoint[]
  granularity: Granularity
  /**
   * The window's buckets, first and count — the chart's horizontal layout. May run past the last
   * point (a window dragged beyond today), leaving empty slots on the right.
   */
  slotStart: number
  slotCount: number
  /** Net worth as the period opened: what "up" or "down" (the line's colour) is measured from. */
  baseline: number
  /** The selected month, or null when none is — the chart then reads as the latest month. */
  selectedIndex: number | null
  onSelect: (index: number | null) => void
  /**
   * A pinch or two-finger drag began, or finished. The parent notes the window when the first one
   * begins — onZoom's totals apply to it — and forgets it when the last one ends.
   */
  onZoomStart: () => void
  onZoomEnd: () => void
  /**
   * The pinch so far, as totals since it began. `scale` is the pinch's scale (above 1 is in), or -1
   * when only `drift` changed; `focus` is where the fingers are, as a share of the chart's width;
   * `drift` is how far they've moved together, as a share of the width (positive is rightward).
   */
  onZoom: (scale: number, focus: number, drift: number) => void
  /** Drawing width. Defaults to the full window, for a chart that runs edge to edge. */
  width?: number
  /** Drawing height. Defaults to CHART_H; the bar band scales with it so the layout keeps its shape. */
  height?: number
}

const CHART_H = 380
/** Room above the line for the selected month's label. */
const PAD_T = 28
/** Rough advance of the 11px label font, to keep a label clear of the screen edges. */
const LABEL_CHAR_W = 6.5
/** Breathing room under the line's lowest point, above the chart's bottom edge. */
const BOTTOM_PAD = 4
/** The line's scale spans at least this share of net worth. */
const MIN_LINE_SPAN = 0.02

/** Finger travel under this is a tap, not a drag. */
const TAP_SLOP = 8
/** How long a finger must rest before a drag scrubs instead of sliding. */
const SCRUB_HOLD_MS = 250

/**
 * Full-bleed, axis-free trend chart: the net worth line alone, smoothed and green when the period is
 * up (red when down), scaled to its own low and high the way a stock chart is, so its movement fills
 * the space. A day's size is read by tapping it — the headline shows its change — rather than drawn
 * as a bar beside the line that would only repeat its slope.
 */
export function NetWorthTrendChart({
  points,
  accountPoints,
  granularity,
  slotStart,
  slotCount,
  baseline,
  selectedIndex,
  onSelect,
  onZoomStart,
  onZoomEnd,
  onZoom,
  width,
  height,
}: NetWorthTrendChartProps) {
  const { width: windowW } = useWindowDimensions()
  const chartW = width ?? windowW
  const chartH = height ?? CHART_H
  const lineTop = PAD_T
  const lineBottom = chartH - BOTTOM_PAD

  const { slot, firstOffset, pixelPts, linePath, areaPath } = useMemo(() => {
    // One slot per bucket in the window, point at its centre. Laid out against the window, not the
    // data, so a window past today keeps empty slots on the right.
    const slot = chartW / Math.max(slotCount, 1)
    const toX = (p: { bucket: number }) => (p.bucket - slotStart + 0.5) * slot
    // Where the first point sits among the slots — for turning a finger's slot back into a point.
    const firstOffset = (accountPoints[0]?.bucket ?? slotStart) - slotStart

    // The line: fitted to its own range. The opening value is included so the period's start is
    // in frame even when the first month moved a lot.
    // At least 2% of net worth tall, so a quiet week reads as quiet rather than as a cliff.
    const lineValues = [...points.map((p) => p.netWorth), baseline]
    const typical = Math.abs(lineValues.reduce((sum, v) => sum + v, 0) / lineValues.length)
    const lineRange = fittedExtent(lineValues, 0.12, typical * MIN_LINE_SPAN)
    const toLineY = (v: number) =>
      lineBottom - ((v - lineRange.min) / (lineRange.max - lineRange.min)) * (lineBottom - lineTop)
    const pts = points.map((p, i) => ({ x: toX(accountPoints[i]), y: toLineY(p.netWorth) }))
    // Smoothed without overshoot: monotone, so no peak or dip appears that the data doesn't have.
    // Points sit at slot centres, so the line is carried flat out to the left edge it would
    // otherwise stop half a slot short of. It always ENDS at the latest point, though — the live
    // dot — the way a stock chart's line ends at the last price.
    const traced = pts.length >= 2 && firstOffset === 0 ? [{ x: 0, y: pts[0].y }, ...pts] : pts
    const line = monotoneLine(traced)
    const area =
      traced.length < 2 ? '' : `${line} L ${traced[traced.length - 1].x} ${lineBottom} L ${traced[0].x} ${lineBottom} Z`

    return {
      slot,
      firstOffset,
      pixelPts: pts,
      linePath: line,
      areaPath: area,
    }
  }, [points, accountPoints, slotStart, slotCount, baseline, chartW, lineTop, lineBottom])

  const nearestIndex = (x: number) => {
    if (pixelPts.length === 0) return null
    let best = 0
    for (let i = 1; i < pixelPts.length; i++) {
      if (Math.abs(pixelPts[i].x - x) < Math.abs(pixelPts[best].x - x)) best = i
    }
    return best
  }

  // Gesture callbacks run on the UI thread and reach React through runOnJS, which needs functions
  // whose identity never changes — a worklet captures what it closes over when it's built. So each
  // entry point below is stable and reads the latest props through a ref.
  const handlers = useRef({ nearestIndex, selectedIndex, onSelect, onZoomStart, onZoomEnd, onZoom })
  handlers.current = { nearestIndex, selectedIndex, onSelect, onZoomStart, onZoomEnd, onZoom }

  // A tap selects the point under it; tapping the selected point again clears it.
  const tapAt = useCallback((x: number) => {
    const { nearestIndex: nearest, selectedIndex: current, onSelect: select } = handlers.current
    const tapped = nearest(x)
    select(tapped != null && tapped === current ? null : tapped)
  }, [])
  // Press-and-hold, then drag: scrubs; wherever it ends stays selected. The gesture works out the
  // index itself and only calls this when it changes.
  const selectIndex = useCallback((index: number) => handlers.current.onSelect(index), [])
  // The last index the scrub reported, on the UI thread — so a finger moving within one bar's slot
  // (dozens of frames at daily resolution) crosses to JS zero times instead of every frame.
  const lastScrub = useSharedValue(-1)
  const count = pixelPts.length
  const zoomStart = useCallback(() => handlers.current.onZoomStart(), [])
  const zoomEnd = useCallback(() => handlers.current.onZoomEnd(), [])
  const zoomTo = useCallback((scale: number, focus: number, drift: number) => handlers.current.onZoom(scale, focus, drift), [])

  const gesture = useMemo(() => {
    const tap = Gesture.Tap().onEnd((e, success) => {
      if (success) runOnJS(tapAt)(e.x)
    })
    // A plain one-finger drag slides the window through time; horizontal only, so a vertical swipe
    // over the chart still scrolls the page. It reports through the same totals as a pinch.
    const slide = Gesture.Pan()
      .maxPointers(1)
      .activeOffsetX([-TAP_SLOP, TAP_SLOP])
      .failOffsetY([-TAP_SLOP * 1.5, TAP_SLOP * 1.5])
      .onStart(() => runOnJS(zoomStart)())
      .onUpdate((e) => runOnJS(zoomTo)(-1, 0, e.translationX / chartW))
      .onEnd(() => runOnJS(zoomEnd)())
    // Press and hold, then drag, to scrub point by point; wherever it ends stays selected. It races
    // the slide: holding still past the delay makes it scrub, moving first makes it slide.
    const scrub = Gesture.Pan()
      .maxPointers(1)
      .activateAfterLongPress(SCRUB_HOLD_MS)
      .onStart((e) => {
        // Points sit one per slot, so the one under the finger is plain arithmetic; a finger over
        // an empty slot past today reads the last point.
        const index = Math.min(Math.max(Math.floor(e.x / slot) - firstOffset, 0), count - 1)
        lastScrub.value = index
        runOnJS(selectIndex)(index)
      })
      .onUpdate((e) => {
        const index = Math.min(Math.max(Math.floor(e.x / slot) - firstOffset, 0), count - 1)
        if (index === lastScrub.value) return
        lastScrub.value = index
        runOnJS(selectIndex)(index)
      })
    // Pinch zooms about the fingers; the fingers drifting together pans. Reported as totals since
    // the pinch began, which the parent applies to the window as it stood then — so a slow pinch
    // accumulates instead of rounding away to nothing frame by frame.
    const pinch = Gesture.Pinch()
      .onStart(() => runOnJS(zoomStart)())
      .onUpdate((e) => runOnJS(zoomTo)(e.scale, e.focalX / chartW, 0))
      // onEnd runs for every gesture that reached onStart, cancelled or not, so the count balances.
      .onEnd(() => runOnJS(zoomEnd)())
    const drift = Gesture.Pan()
      .minPointers(2)
      .averageTouches(true)
      .onStart(() => runOnJS(zoomStart)())
      .onUpdate((e) => runOnJS(zoomTo)(-1, 0, e.translationX / chartW))
      // onEnd runs for every gesture that reached onStart, cancelled or not, so the count balances.
      .onEnd(() => runOnJS(zoomEnd)())
    return Gesture.Race(Gesture.Simultaneous(pinch, drift), Gesture.Race(scrub, slide), tap)
  }, [chartW, slot, firstOffset, count, lastScrub, tapAt, selectIndex, zoomStart, zoomEnd, zoomTo])

  if (points.length === 0) return null

  const selected = selectedIndex != null ? pixelPts[selectedIndex] : undefined
  const selectedPoint = selectedIndex != null ? accountPoints[selectedIndex] : undefined
  const selectedLabel = selectedPoint ? formatTrendLabel(selectedPoint.start, granularity, 'long') : ''
  const selectedLabelHalfW = (selectedLabel.length * LABEL_CHAR_W) / 2

  // Stock-chart convention: green when the period ended above where it opened, red below.
  const latest = pixelPts[pixelPts.length - 1]
  const isUp = (points[points.length - 1]?.netWorth ?? 0) >= baseline
  const lineColor = isUp ? colors.income : colors.expense

  return (
    <GestureDetector gesture={gesture}>
    <View>
      <Svg width={chartW} height={chartH}>
        {/* A layer that redraws only when its own inputs change: selecting a point redraws the
            marker, not the line. */}
        <LineLayer areaPath={areaPath} linePath={linePath} lineColor={lineColor} />

        {/* The "live" marker on the latest point, while nothing is selected. */}
        {latest && selected == null ? <LiveDot x={latest.x} y={latest.y} color={lineColor} /> : null}


        {selected ? (
          <G>
            {/* A guide from the top of the chart to the bottom, through the point being read. */}
            <Line
              x1={selected.x}
              y1={lineTop}
              x2={selected.x}
              y2={lineBottom}
              stroke={colors.textSecondary}
              strokeWidth={1}
              strokeDasharray="3,3"
              opacity={0.7}
            />
            {/* The month being read, above the line — clamped so an edge month isn't clipped. */}
            <SvgText
              x={Math.min(Math.max(selected.x, selectedLabelHalfW + 4), chartW - selectedLabelHalfW - 4)}
              y={PAD_T - 10}
              fontSize={11}
              fontFamily={fontFamily.sansSemi}
              fill={colors.textPrimary}
              textAnchor="middle"
            >
              {selectedLabel}
            </SvgText>
            <Circle cx={selected.x} cy={selected.y} r={9} fill={hexToRgba(lineColor, 0.18)} />
            <Circle cx={selected.x} cy={selected.y} r={5} fill={colors.surface} stroke={lineColor} strokeWidth={2.5} />
          </G>
        ) : null}
      </Svg>
    </View>
    </GestureDetector>
  )
}

/** The net worth line and the fading area under it. */
const LineLayer = memo(function LineLayer({
  areaPath,
  linePath,
  lineColor,
}: {
  areaPath: string
  linePath: string
  lineColor: string
}) {
  return (
    <G>
      <Defs>
        <LinearGradient id="netWorthArea" x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0" stopColor={lineColor} stopOpacity={0.2} />
          <Stop offset="1" stopColor={lineColor} stopOpacity={0} />
        </LinearGradient>
      </Defs>
      {areaPath ? <Path d={areaPath} fill="url(#netWorthArea)" /> : null}
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
const LiveDot = memo(function LiveDot({ x, y, color }: { x: number; y: number; color: string }) {
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
