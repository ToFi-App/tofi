import { useMemo, useRef } from 'react'
import { PanResponder, View, useWindowDimensions } from 'react-native'
import Svg, { Circle, G, Line, Path, Rect, Text as SvgText } from 'react-native-svg'
import { colors, fontFamily, hexToRgba } from '@/constants/theme'
import { niceExtent } from '@/lib/charts/lineChart'
import type { AccountMonthPoint, MonthPoint } from '@/lib/accounts/netWorthHistory'
import { stackMonth, type NetWorthSeries } from '@/lib/accounts/netWorthSeries'
import { seriesColor } from './netWorthPalette'

interface NetWorthTrendChartProps {
  points: MonthPoint[]
  /** Per-account balances for the same months as `points`, drawn as a stacked bar per month. */
  accountPoints: AccountMonthPoint[]
  series: NetWorthSeries[]
  /** Net worth as the period opened; drawn as the dotted reference line. */
  baseline: number
  /** The selected month, or null when none is — the chart then reads as the latest month. */
  selectedIndex: number | null
  onSelect: (index: number | null) => void
  /** An account highlighted from the map or the rows: its segment stays solid, the rest recede. */
  highlightedKey?: string | null
}

const CHART_H = 300
const PAD_T = 16
const X_H = 24

// Bars take this share of their month's slot, capped so a short history doesn't draw slabs.
const BAR_FILL = 0.62
const BAR_MAX_W = 22
/** Empty seam between stacked segments, so neighbours never merge into one band. A real gap, not a
 *  stroke, so it shows whatever the chart sits on. */
const SEGMENT_GAP = 1.5

/** Absolute month index, so the x-axis runs continuously across year boundaries. */
function monthIndex(p: { year: number; month: number }): number {
  return p.year * 12 + (p.month - 1)
}

/**
 * Full-bleed, axis-free trend chart: stacked per-account bars under the net worth line.
 *
 * No y-axis and no gridlines. The headline above the chart is the reading — it follows the
 * finger while scrubbing — so tick labels would be a second, less precise copy of the same
 * number competing for the width the bars need. The one horizontal reference kept is the dotted
 * line at the period's opening value, which answers "up or down?" at a glance.
 */
/** Finger travel under this is a tap, not a drag. */
const TAP_SLOP = 8

export function NetWorthTrendChart({
  points,
  accountPoints,
  series,
  baseline,
  selectedIndex,
  onSelect,
  highlightedKey,
}: NetWorthTrendChartProps) {
  const { width: chartW } = useWindowDimensions()
  const plotH = CHART_H - PAD_T - X_H

  const { pixelPts, bars, barW, baselineY, zeroY, linePath, xTicks } = useMemo(() => {
    const stacks = accountPoints.map((m) => stackMonth(series, m.balances))
    const values = [...points.map((p) => p.netWorth), baseline]
    for (const stack of stacks) for (const seg of stack) values.push(seg.to)
    // niceExtent only for its headroom — nothing reads the ticks any more.
    const scale = niceExtent(Math.min(...values, 0), Math.max(...values, 0), 3)
    const yMin = scale[0]
    const yMax = scale[scale.length - 1]
    const toY = (v: number) => PAD_T + plotH - ((v - yMin) / (yMax - yMin)) * plotH

    // One slot per month with the point at its centre, so the first and last bars have room at
    // the screen edges. Spans the actual months, so a short history still fills the width.
    const firstIdx = points.length > 0 ? monthIndex(points[0]) : 0
    const lastIdx = points.length > 0 ? monthIndex(points[points.length - 1]) : 0
    const slot = chartW / Math.max(lastIdx - firstIdx + 1, 1)
    const toX = (p: { year: number; month: number }) => (monthIndex(p) - firstIdx + 0.5) * slot
    const width = Math.max(Math.min(slot * BAR_FILL, BAR_MAX_W), 2)

    const colorByKey = new Map(series.map((s) => [s.key, seriesColor(s)]))
    const barRects = stacks.map((stack, i) =>
      stack.map((seg) => {
        const y1 = toY(seg.from)
        const y2 = toY(seg.to)
        return {
          key: seg.key,
          x: toX(accountPoints[i]) - width / 2,
          y: Math.min(y1, y2),
          height: Math.abs(y2 - y1),
          color: colorByKey.get(seg.key) ?? colors.border,
        }
      }),
    )

    const pts = points.map((p) => ({ x: toX(p), y: toY(p.netWorth) }))
    const line = pts.length < 2 ? '' : `M ${pts.map((p) => `${p.x} ${p.y}`).join(' L ')}`

    // Within a year, a few "MM" marks; across years, each January labelled with its year
    // (thinned when many years would crowd the axis).
    let labels: { x: number; text: string }[]
    if (lastIdx - firstIdx < 12) {
      const stride = Math.max(1, Math.ceil(points.length / 6))
      labels = points
        .filter((_, i) => i % stride === 0)
        .map((p) => ({ x: toX(p), text: String(p.month).padStart(2, '0') }))
    } else {
      const januaries = points.filter((p) => p.month === 1)
      const yearStride = Math.max(1, Math.ceil(januaries.length / 5))
      labels = januaries
        .filter((_, i) => i % yearStride === 0)
        .map((p) => ({ x: toX(p), text: String(p.year) }))
    }

    return {
      pixelPts: pts,
      bars: barRects,
      barW: width,
      baselineY: toY(baseline),
      zeroY: toY(0),
      linePath: line,
      xTicks: labels,
    }
  }, [points, accountPoints, series, baseline, chartW, plotH])

  // Read inside the responder, which is rebuilt only when the geometry changes — a ref keeps it
  // from acting on the selection as it stood when it was built.
  const selectedRef = useRef(selectedIndex)
  selectedRef.current = selectedIndex
  // What was selected when this touch began, so a tap can tell "same month again" (clear) from
  // "a different month" (move the selection there).
  const touchRef = useRef<{ startX: number; selectedAtStart: number | null; moved: boolean } | null>(null)

  const panResponder = useMemo(() => {
    const nearestIndex = (locationX: number) => {
      if (pixelPts.length === 0) return null
      let best = 0
      for (let i = 1; i < pixelPts.length; i++) {
        if (Math.abs(pixelPts[i].x - locationX) < Math.abs(pixelPts[best].x - locationX)) best = i
      }
      return best
    }
    return PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      // The chart sits inside a scrollable sheet; once a finger is reading the line, the
      // scroll (or the sheet's drag-to-dismiss) must not steal the gesture mid-scrub.
      onPanResponderTerminationRequest: () => false,
      // Selecting is sticky: a tap or a drag leaves its month selected after the finger lifts, and
      // only tapping that same month again clears it. Dragging still scrubs, so the headline and
      // the rows can be run along the chart; wherever the drag ends is what stays selected.
      onPanResponderGrant: (evt) => {
        const x = evt.nativeEvent.locationX
        touchRef.current = { startX: x, selectedAtStart: selectedRef.current, moved: false }
        onSelect(nearestIndex(x))
      },
      onPanResponderMove: (evt) => {
        const touch = touchRef.current
        const x = evt.nativeEvent.locationX
        if (touch && Math.abs(x - touch.startX) > TAP_SLOP) touch.moved = true
        if (touch?.moved) onSelect(nearestIndex(x))
      },
      onPanResponderRelease: (evt) => {
        const touch = touchRef.current
        touchRef.current = null
        if (!touch || touch.moved) return
        const tapped = nearestIndex(evt.nativeEvent.locationX)
        if (tapped != null && tapped === touch.selectedAtStart) onSelect(null)
      },
      // Interrupted rather than finished: leave whatever the finger last selected.
      onPanResponderTerminate: () => {
        touchRef.current = null
      },
    })
  }, [pixelPts, onSelect])

  if (points.length === 0) return null

  const selected = selectedIndex != null ? pixelPts[selectedIndex] : undefined

  return (
    <View {...panResponder.panHandlers}>
      <Svg width={chartW} height={CHART_H}>
        {/* Bars first, so the line always reads on top of them. With a month selected, the
            others step back, which ties the headline and the account rows to one bar. */}
        {bars.map((stack, i) => (
          <G key={i} opacity={selected == null || i === selectedIndex ? 1 : 0.4}>
            {stack.map((seg) => (
              <Rect
                key={seg.key}
                x={seg.x}
                y={seg.y + SEGMENT_GAP / 2}
                width={barW}
                height={Math.max(seg.height - SEGMENT_GAP, 0)}
                rx={Math.min(2, barW / 4)}
                fill={seg.color}
                opacity={highlightedKey == null || seg.key === highlightedKey ? 1 : 0.25}
              />
            ))}
          </G>
        ))}

        {/* The zero line, solid, so debt reads as below zero rather than as a shorter bar. */}
        <Line x1={0} y1={zeroY} x2={chartW} y2={zeroY} stroke={colors.textSecondary} strokeWidth={1} />

        <Line
          x1={0}
          y1={baselineY}
          x2={chartW}
          y2={baselineY}
          stroke={colors.textPrimary}
          strokeWidth={1.5}
          strokeDasharray="1.5,5"
          strokeLinecap="round"
        />

        {linePath ? <Path d={linePath} stroke={colors.primary} strokeWidth={2.5} fill="none" strokeLinejoin="round" /> : null}

        {/* A single month has no line to read a trend from — anchor it to the zero baseline. */}
        {pixelPts.length === 1 ? (
          <>
            <Circle cx={pixelPts[0].x} cy={pixelPts[0].y} r={3.5} fill={colors.surface} stroke={colors.primary} strokeWidth={2} />
            <Line
              x1={pixelPts[0].x}
              y1={pixelPts[0].y}
              x2={pixelPts[0].x}
              y2={zeroY}
              stroke={hexToRgba(colors.primary, 0.35)}
              strokeWidth={1.5}
            />
          </>
        ) : null}

        {xTicks.map((tick) => (
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

        {selected ? (
          <G>
            <Line x1={selected.x} y1={PAD_T} x2={selected.x} y2={PAD_T + plotH} stroke={hexToRgba(colors.primary, 0.45)} strokeWidth={1} />
            <Circle cx={selected.x} cy={selected.y} r={5} fill={colors.surface} stroke={colors.primary} strokeWidth={2.5} />
          </G>
        ) : null}
      </Svg>
    </View>
  )
}
