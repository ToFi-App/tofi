import { useCallback, useMemo, useRef } from 'react'
import { View, useWindowDimensions } from 'react-native'
import { Gesture, GestureDetector } from 'react-native-gesture-handler'
import { runOnJS, useSharedValue } from 'react-native-reanimated'
import Svg, { Circle, G, Line, Text as SvgText } from 'react-native-svg'
import { colors, fontFamily, hexToRgba } from '@/constants/theme'
import { fittedExtent, monotoneLine, slotX } from '@/lib/charts/lineChart'
import { formatTrendLabel, type Granularity, type TrendPoint } from '@/lib/accounts/netWorthHistory'

/** What the chart reads of a point's position: its bucket for x, its first day for the label. */
export type TrendSlot = Pick<TrendPoint, 'bucket' | 'start'>
import { LineLayer, LiveDot } from '@/components/visualizations/TrendLine'

interface TrendChartProps {
  /** The line's value per point — the same points as `slots`. */
  points: { value: number }[]
  /** Each point's bucket and first day (day, week or month) — for the x positions and dates. */
  slots: TrendSlot[]
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
  /**
   * Overrides the line's colour, which otherwise follows the last point against `baseline`. For a
   * series whose movement isn't its performance: an investment account's line rises with deposits.
   */
  isUp?: boolean
  /** The area fill's gradient id; distinct per mounted chart. */
  gradientId?: string
  /**
   * Dots on the line at these points' indices — a stock's buys and sells. `label` is the tooltip
   * shown with the date while that point is selected (tapped, or reached by press-and-hold).
   */
  markers?: Array<{ index: number; color: string; radius?: number; label?: string }>
}

const CHART_H = 380
/** Room left after the last slot, so the live dot's ripple isn't clipped by the chart's edge. */
const END_INSET = 8
/** Room above the line for the selected month's label. */
const PAD_T = 28
/** The extra line a trade tooltip takes above the date. */
const TOOLTIP_LINE_H = 15
/** Rough advance of the 11px label font, to keep a label clear of the screen edges. */
const LABEL_CHAR_W = 6.5
/** Breathing room under the line's lowest point, above the chart's bottom edge. */
const BOTTOM_PAD = 4
/** The line's scale spans at least this share of its typical value. */
const MIN_LINE_SPAN = 0.02

/** Finger travel under this is a tap, not a drag. */
const TAP_SLOP = 8
/** How long a finger must rest before a drag scrubs instead of sliding. */
const SCRUB_HOLD_MS = 250

/**
 * Full-bleed, axis-free trend chart — net worth, an account's value: the line alone, smoothed and green when the period is
 * up (red when down), scaled to its own low and high the way a stock chart is, so its movement fills
 * the space. A day's size is read by tapping it — the headline shows its change — rather than drawn
 * as a bar beside the line that would only repeat its slope.
 */
export function TrendChart({
  points,
  slots,
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
  isUp: isUpOverride,
  gradientId = 'trendArea',
  markers,
}: TrendChartProps) {
  const { width: windowW } = useWindowDimensions()
  const chartW = width ?? windowW
  const chartH = height ?? CHART_H
  // A chart with trade markers keeps a second line of headroom for a selected trade's tooltip.
  const padTop = markers && markers.length > 0 ? PAD_T + TOOLTIP_LINE_H : PAD_T
  const lineTop = padTop
  const lineBottom = chartH - BOTTOM_PAD

  const { firstOffset, pixelPts, linePath, areaPath } = useMemo(() => {
    // One slot per bucket in the window, the first on the left edge and the last on the right (see
    // slotX). Laid out against the window, not the data, so a window past today keeps empty slots on
    // the right.
    const toX = (p: { bucket: number }) => slotX(p.bucket - slotStart, slotCount, chartW, END_INSET)
    // Where the first point sits among the slots — for turning a finger's slot back into a point.
    const firstOffset = (slots[0]?.bucket ?? slotStart) - slotStart

    // The line: fitted to its own range. The opening value is included so the period's start is
    // in frame even when the first month moved a lot.
    // At least 2% of net worth tall, so a quiet week reads as quiet rather than as a cliff.
    const lineValues = [...points.map((p) => p.value), baseline]
    const typical = Math.abs(lineValues.reduce((sum, v) => sum + v, 0) / lineValues.length)
    const lineRange = fittedExtent(lineValues, 0.12, typical * MIN_LINE_SPAN)
    const toLineY = (v: number) =>
      lineBottom - ((v - lineRange.min) / (lineRange.max - lineRange.min)) * (lineBottom - lineTop)
    const pts = points.map((p, i) => ({ x: toX(slots[i]), y: toLineY(p.value) }))
    // Smoothed without overshoot: monotone, so no peak or dip appears that the data doesn't have.
    // It ENDS at the latest point — the live dot — the way a stock chart's line ends at the last
    // price; with the window ending today, that's the right edge.
    const line = monotoneLine(pts)
    const area = pts.length < 2 ? '' : `${line} L ${pts[pts.length - 1].x} ${lineBottom} L ${pts[0].x} ${lineBottom} Z`

    return {
      firstOffset,
      pixelPts: pts,
      linePath: line,
      areaPath: area,
    }
  }, [points, slots, slotStart, slotCount, baseline, chartW, lineTop, lineBottom])

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

  // slotAt's layout, as plain numbers the scrub worklet can close over.
  const usableW = chartW - END_INSET
  const span = Math.max(slotCount - 1, 1)
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
        // Points must sit one per slot — callers fill calendar days (fillCalendarDays) — so the one
        // under the finger is plain arithmetic — slotAt's, inlined,
        // since this runs on the UI thread; a finger over an empty slot past today reads the last point.
        const index = Math.min(Math.max(Math.round((e.x / usableW) * span) - firstOffset, 0), count - 1)
        lastScrub.value = index
        runOnJS(selectIndex)(index)
      })
      .onUpdate((e) => {
        const index = Math.min(Math.max(Math.round((e.x / usableW) * span) - firstOffset, 0), count - 1)
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
  }, [usableW, span, firstOffset, count, lastScrub, tapAt, selectIndex, zoomStart, zoomEnd, zoomTo])

  if (points.length === 0) return null

  const selected = selectedIndex != null ? pixelPts[selectedIndex] : undefined
  const selectedPoint = selectedIndex != null ? slots[selectedIndex] : undefined
  // A selected trade day reads its trades ("BUY 5 shares") on a line of their own above the date, in
  // the dot's colour; a day with both a buy and a sell names both.
  const selectedMarkers = selectedIndex != null ? (markers ?? []).filter((m) => m.index === selectedIndex && m.label) : []
  const selectedLabel = selectedPoint ? formatTrendLabel(selectedPoint.start, granularity, 'long') : ''
  const tradeLabel = selectedMarkers.map((m) => m.label).join(', ')
  const tradeLabelColor = selectedMarkers.length === 1 ? selectedMarkers[0].color : colors.textPrimary
  const selectedLabelHalfW = (Math.max(selectedLabel.length, tradeLabel.length) * LABEL_CHAR_W) / 2
  const labelX = selected ? Math.min(Math.max(selected.x, selectedLabelHalfW + 4), chartW - selectedLabelHalfW - 4) : 0

  // Stock-chart convention: green when the period ended above where it opened, red below.
  const latest = pixelPts[pixelPts.length - 1]
  const isUp = isUpOverride ?? (points[points.length - 1]?.value ?? 0) >= baseline
  const lineColor = isUp ? colors.income : colors.expense

  return (
    <GestureDetector gesture={gesture}>
    <View>
      <Svg width={chartW} height={chartH}>
        {/* A layer that redraws only when its own inputs change: selecting a point redraws the
            marker, not the line. */}
        <LineLayer gradientId={gradientId} areaPath={areaPath} linePath={linePath} lineColor={lineColor} />

        {markers?.map((marker) => {
          const at = pixelPts[marker.index]
          if (!at) return null
          return (
            <Circle
              key={`m${marker.index}-${marker.color}`}
              cx={at.x}
              cy={at.y}
              r={marker.radius ?? 3.5}
              fill={marker.color}
              stroke={colors.surface}
              strokeWidth={1.5}
            />
          )
        })}

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
            {/* The point being read, above the line — clamped so an edge point isn't clipped. */}
            {tradeLabel ? (
              <SvgText
                x={labelX}
                y={padTop - 10 - TOOLTIP_LINE_H}
                fontSize={11}
                fontFamily={fontFamily.sansSemi}
                fill={tradeLabelColor}
                textAnchor="middle"
              >
                {tradeLabel}
              </SvgText>
            ) : null}
            <SvgText
              x={labelX}
              y={padTop - 10}
              fontSize={11}
              fontFamily={fontFamily.sansSemi}
              fill={tradeLabel ? colors.textSecondary : colors.textPrimary}
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
