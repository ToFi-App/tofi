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
import Svg, { Circle, Defs, G, Line, LinearGradient, Path, Rect, Stop, Text as SvgText } from 'react-native-svg'
import { colors, fontFamily, hexToRgba } from '@/constants/theme'
import { fittedExtent, monotoneLine } from '@/lib/charts/lineChart'
import { formatTrendLabel, type Granularity, type TrendPoint } from '@/lib/accounts/netWorthHistory'
import { periodChanges } from '@/lib/accounts/netWorthSeries'

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
  /** An account highlighted from the map or the rows: the bars then measure that account's moves. */
  highlightedKey?: string | null
}

const CHART_H = 380
/** Room above the line for the selected month's label. */
const PAD_T = 28
/** Rough advance of the 11px label font, to keep a label clear of the screen edges. */
const LABEL_CHAR_W = 6.5
const X_H = 24

// Price-and-volume layout, overlapping like a stock chart's: the bars rise from the bottom on
// their own scale, and the line, on its own, may come down into their upper half.
const BAND_H = 130
/** How far into the bar band the line's lowest point may reach, as a share of the band. */
const LINE_OVERLAP = 0.5

// Bars take this share of their slot, capped so a short history doesn't draw slabs, and floored so
// a 90-day range still draws something.
const BAR_FILL = 0.6
const BAR_MAX_W = 20
const BAR_MIN_W = 1.5
/** How many dates the x-axis names, spread evenly. */
const X_TICKS = 5
/** Half the widest short label ("May 18"), so the outermost ones sit fully on screen. */
const X_LABEL_INSET = 24
/** The line's scale spans at least this share of net worth. */
const MIN_LINE_SPAN = 0.02
/** Corner radius for a stack's outer end: one rounded cap per column, square seams inside it. */
const BAR_RADIUS = 3

/** A bar that isn't the selected one, or a band that isn't the highlighted account. */
const DIMMED_OPACITY = 0.3

/**
 * A rect with only its top corners rounded (or only its bottom ones), as a path — the outer end of
 * a stacked column. Radius is capped by the rect's own size so a thin band never inverts.
 */
function capPath(x: number, y: number, w: number, h: number, r: number, end: 'top' | 'bottom'): string {
  const rr = Math.max(0, Math.min(r, w / 2, h))
  if (end === 'top') {
    return `M ${x} ${y + h} L ${x} ${y + rr} Q ${x} ${y} ${x + rr} ${y} L ${x + w - rr} ${y} Q ${x + w} ${y} ${x + w} ${y + rr} L ${x + w} ${y + h} Z`
  }
  return `M ${x} ${y} L ${x + w} ${y} L ${x + w} ${y + h - rr} Q ${x + w} ${y + h} ${x + w - rr} ${y + h} L ${x + rr} ${y + h} Q ${x} ${y + h} ${x} ${y + h - rr} Z`
}

/** Finger travel under this is a tap, not a drag. */
const TAP_SLOP = 8
/** How long a finger must rest before a drag scrubs instead of sliding. */
const SCRUB_HOLD_MS = 250

/**
 * Full-bleed, axis-free trend chart in a price-and-volume layout. The net worth line, smoothed and
 * green when the period is up (red when down), is scaled to its own low and high the way a stock
 * chart is, so its movement fills the space. Beneath it each point's bar shows how
 * much net worth moved, green up and red down, like a stock's volume.
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
  highlightedKey,
}: NetWorthTrendChartProps) {
  const { width: chartW } = useWindowDimensions()
  const lineTop = PAD_T
  const bandBottom = CHART_H - X_H
  const lineBottom = bandBottom - BAND_H * LINE_OVERLAP

  const { slot, firstOffset, pixelPts, bars, linePath, areaPath, xTicks } = useMemo(() => {
    // One slot per bucket in the window, point at its centre. Laid out against the window, not the
    // data, so a window past today keeps empty slots on the right.
    const slot = chartW / Math.max(slotCount, 1)
    const toX = (p: { bucket: number }) => (p.bucket - slotStart + 0.5) * slot
    // Where the first point sits among the slots — for turning a finger's slot back into a point.
    const firstOffset = (accountPoints[0]?.bucket ?? slotStart) - slotStart
    const width = Math.max(Math.min(slot * BAR_FILL, BAR_MAX_W), BAR_MIN_W)

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
    // Points sit at bar centres, so the line is carried flat out to the left edge it would
    // otherwise stop half a bar short of. It always ENDS at the latest point, though — the live
    // dot — the way a stock chart's line ends at the last price.
    const traced = pts.length >= 2 && firstOffset === 0 ? [{ x: 0, y: pts[0].y }, ...pts] : pts
    const line = monotoneLine(traced)
    const area =
      traced.length < 2 ? '' : `${line} L ${traced[traced.length - 1].x} ${lineBottom} L ${traced[0].x} ${lineBottom} Z`

    // The band is the chart's "volume": one bar per point, rising from the bottom, as tall as net
    // worth MOVED that point and coloured by direction — green up, red down — like a stock's
    // volume bars. With an account highlighted it measures that account's move instead.
    const moves = accountPoints.map((p, i) => {
      if (highlightedKey != null) return periodChanges(p).get(highlightedKey) ?? 0
      return points[i]?.change ?? 0
    })
    const biggest = Math.max(...moves.map(Math.abs), 0)
    const barRects = moves.map((move, i) => {
      // A move too small to see still gets a sliver, so every non-zero point shows its direction.
      const height = move === 0 || biggest === 0 ? 0 : Math.max((Math.abs(move) / biggest) * BAND_H, 1.5)
      const x = toX(accountPoints[i]) - width / 2
      // The shape is built here, once per window, rather than on every render of the bars.
      return { d: height > 0 ? capPath(x, bandBottom - height, width, height, BAR_RADIUS, 'top') : null, up: move >= 0 }
    })

    // Every Nth point gets a date, at its own bar — the slots are uniform, so a fixed N is evenly
    // spaced both on screen and in time. N is the smallest step that keeps it to X_TICKS labels,
    // so a week labels every day. Points too close to an edge for a centred label are skipped.
    const n = accountPoints.length
    const step = Math.max(1, Math.ceil((n - 1) / (X_TICKS - 1)))
    const labels: { x: number; text: string }[] = []
    const fits = (x: number) => x >= X_LABEL_INSET && x <= chartW - X_LABEL_INSET
    let first = 0
    while (first < n && !fits(toX(accountPoints[first]))) first++
    for (let i = first; i < n; i += step) {
      const x = toX(accountPoints[i])
      if (!fits(x)) break
      labels.push({ x, text: formatTrendLabel(accountPoints[i].start, granularity, 'short') })
    }

    return {
      slot,
      firstOffset,
      pixelPts: pts,
      bars: barRects,
      linePath: line,
      areaPath: area,
      xTicks: labels,
    }
  }, [points, accountPoints, granularity, slotStart, slotCount, baseline, highlightedKey, chartW, lineTop, lineBottom, bandBottom])

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
    // over the chart still scrolls the sheet. It reports through the same totals as a pinch.
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
      <Svg width={chartW} height={CHART_H}>
        {/* Layers that redraw only when their own inputs change: selecting a point redraws the
            bars (to fade the others) and the marker, not the line or the dates. */}
        <BarsLayer bars={bars} selectedIndex={selectedIndex} />
        <LineLayer areaPath={areaPath} linePath={linePath} lineColor={lineColor} />

        {/* The "live" marker on the latest point, while nothing is selected. */}
        {latest && selected == null ? <LiveDot x={latest.x} y={latest.y} color={lineColor} /> : null}

        <DateLabels ticks={xTicks} />

        {selected ? (
          <G>
            {/* Through the line and the band, tying the dot to its bar. */}
            <Line
              x1={selected.x}
              y1={lineTop}
              x2={selected.x}
              y2={bandBottom}
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

/** The "volume" bars — drawn first so the line and its fill sit over them where the two overlap. */
const BarsLayer = memo(function BarsLayer({
  bars,
  selectedIndex,
}: {
  bars: { d: string | null; up: boolean }[]
  selectedIndex: number | null
}) {
  return (
    <G>
      {bars.map((bar, i) =>
        bar.d ? (
          <Path
            key={i}
            d={bar.d}
            fill={bar.up ? colors.income : colors.expense}
            // With a point selected the other bars step back.
            opacity={selectedIndex != null && selectedIndex !== i ? DIMMED_OPACITY : 1}
          />
        ) : null,
      )}
    </G>
  )
})

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
        <Path d={linePath} stroke={lineColor} strokeWidth={2.5} fill="none" strokeLinejoin="round" strokeLinecap="round" />
      ) : null}
    </G>
  )
})

/** The dates along the bottom. */
const DateLabels = memo(function DateLabels({ ticks }: { ticks: { x: number; text: string }[] }) {
  return (
    <G>
      {ticks.map((tick) => (
        <SvgText
          key={`${tick.text}-${tick.x}`}
          x={tick.x}
          y={CHART_H - 6}
          fontSize={11}
          fontFamily={fontFamily.mono}
          fill={colors.textMuted}
          textAnchor="middle"
        >
          {tick.text}
        </SvgText>
      ))}
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
