import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { TrendRange } from '@/lib/accounts/netWorthHistory'
import { futureBuffer, panViewport, rangeViewport, zoomViewport, type Viewport } from '@/lib/accounts/trendViewport'

/**
 * The window a zoomable trend chart shows, and every gesture that moves it: range pills set it,
 * pinching zooms it about the fingers, one- and two-finger drags pan it, and a tapped or scrubbed
 * point is selected within it. Shared by the net worth panel and the investment account sheet, so
 * both charts move the same way.
 *
 * Day numbers throughout (days since 1970-01-01, see dayOf). `earliestDay` bounds how far back the
 * window can go; it may move after the first render as history loads, and a pill's window follows.
 */
export function useTrendViewport({
  earliestDay,
  todayDay,
  yearStartDay,
  defaultRange,
}: {
  earliestDay: number
  todayDay: number
  yearStartDay: number
  defaultRange: TrendRange
}) {
  const bounds = useMemo(() => ({ minDay: earliestDay, maxDay: todayDay }), [earliestDay, todayDay])

  // The pills set the window; pinching moves it and leaves no pill selected. Tapping a pill snaps
  // back to exactly its range.
  const [activeRange, setActiveRange] = useState<TrendRange | null>(defaultRange)
  const [viewport, setViewport] = useState<Viewport>(() => rangeViewport(defaultRange, todayDay, earliestDay, yearStartDay))
  const chooseRange = (range: TrendRange) => {
    setActiveRange(range)
    setViewport(rangeViewport(range, todayDay, earliestDay, yearStartDay))
  }
  // History can arrive after the first render (the feed loads): keep a pill's window in step.
  useEffect(() => {
    if (activeRange) setViewport(rangeViewport(activeRange, todayDay, earliestDay, yearStartDay))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [earliestDay, todayDay])

  // A pinch is applied as totals to the window as it stood when the pinch began.
  const viewportRef = useRef(viewport)
  viewportRef.current = viewport
  const pinchBase = useRef({ viewport, scale: 1, focus: 0.5, drift: 0 })
  // The pinch and the two-finger drag start and end separately; the window is noted when the
  // first begins, so whichever comes second doesn't reset the other's progress.
  const activeZooms = useRef(0)
  const handleZoomStart = useCallback(() => {
    if (activeZooms.current === 0) pinchBase.current = { viewport: viewportRef.current, scale: 1, focus: 0.5, drift: 0 }
    activeZooms.current += 1
  }, [])
  const handleZoomEnd = useCallback(() => {
    activeZooms.current = Math.max(0, activeZooms.current - 1)
  }, [])
  const pendingViewport = useRef<Viewport | null>(null)
  const frameRequest = useRef<number | null>(null)
  const handleZoom = useCallback(
    (scale: number, focus: number, drift: number) => {
      const base = pinchBase.current
      // The pinch and the two-finger drag report separately; each keeps its latest total here.
      if (scale > 0) {
        base.scale = scale
        base.focus = focus
      } else {
        base.drift = drift
      }
      // Gestures may carry the window a little past today (futureBuffer), sized to the window
      // they produce so a year view gets proportionally more room than a week.
      const pastToday = (span: number) => ({ ...bounds, maxDay: bounds.maxDay + futureBuffer(span) })
      const baseSpan = base.viewport.endDay - base.viewport.startDay + 1
      const zoomed = zoomViewport(base.viewport, base.scale, base.focus, pastToday(Math.round(baseSpan / base.scale)))
      const span = zoomed.endDay - zoomed.startDay + 1
      // Fingers moving right drag the chart right, which brings earlier days into view.
      pendingViewport.current = panViewport(zoomed, -base.drift * span, pastToday(span))
      // Gestures report faster than the screen draws; apply the latest once per frame, and only
      // when it lands on different days — sub-day finger movement redraws nothing.
      if (frameRequest.current != null) return
      frameRequest.current = requestAnimationFrame(() => {
        frameRequest.current = null
        const next = pendingViewport.current
        if (!next) return
        setViewport((current) =>
          current.startDay === next.startDay && current.endDay === next.endDay ? current : next,
        )
        setActiveRange(null)
      })
    },
    [bounds],
  )
  useEffect(() => () => {
    if (frameRequest.current != null) cancelAnimationFrame(frameRequest.current)
  }, [])

  // Everything that reads a point follows the selection, and falls back to the latest one in view
  // when nothing is selected. The window moving makes an old index meaningless, so it clears.
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null)
  useEffect(() => {
    setSelectedIndex((current) => (current === null ? current : null))
  }, [viewport.startDay, viewport.endDay])
  const handleSelect = useCallback((index: number | null) => setSelectedIndex(index), [])

  return { activeRange, chooseRange, viewport, handleZoomStart, handleZoomEnd, handleZoom, selectedIndex, handleSelect }
}
