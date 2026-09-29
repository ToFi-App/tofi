import { bucketOf, type Granularity, type TrendRange } from './netWorthHistory'

/**
 * The window of days the net worth chart shows, as inclusive day numbers (days since 1970-01-01).
 * The range pills set it; pinching and two-finger dragging move it. The chart then draws whichever
 * points fall inside, at the resolution the window's width calls for (granularityFor).
 */
export interface Viewport {
  startDay: number
  endDay: number
}

export interface ViewportBounds {
  /** The oldest day with data — nothing before it can be reconstructed. */
  minDay: number
  /** Today — nothing after it exists. */
  maxDay: number
}

/** Never closer than a week: fewer points than that says nothing a tap can't. */
export const MIN_SPAN_DAYS = 7

const MS_PER_DAY = 86_400_000

/** Whole days since 1970-01-01 for a YYYY-MM-DD key, in UTC so DST never shifts a day. */
export function dayOf(iso: string): number {
  return Math.floor(Date.parse(`${iso.slice(0, 10)}T00:00:00Z`) / MS_PER_DAY)
}

/** The window a range pill stands for: ending today, starting no earlier than the oldest data. */
export function rangeViewport(range: TrendRange, todayDay: number, earliestDay: number, yearStartDay: number): Viewport {
  const back: Record<Exclude<TrendRange, 'YTD' | 'ALL'>, number> = { '1W': 6, '1M': 29, '3M': 89, '1Y': 364 }
  const start =
    range === 'ALL' ? earliestDay : range === 'YTD' ? yearStartDay : todayDay - back[range]
  return { startDay: Math.max(start, earliestDay), endDay: todayDay }
}

/** The span a window may take, given its bounds: at least a week, at most the whole history. */
function clampSpan(span: number, bounds: ViewportBounds): number {
  const widest = bounds.maxDay - bounds.minDay + 1
  return Math.min(Math.max(span, Math.min(MIN_SPAN_DAYS, widest)), widest)
}

/** Slides a window of fixed width back inside the bounds. */
function shiftInside(startDay: number, span: number, bounds: ViewportBounds): Viewport {
  const start = Math.min(Math.max(startDay, bounds.minDay), bounds.maxDay - span + 1)
  return { startDay: start, endDay: start + span - 1 }
}

/**
 * Zooms by `factor` (above 1 is in, below 1 is out) about `focus`, the fingers' position as a share
 * of the chart's width — the day under the fingers stays under them. The result keeps to the bounds,
 * sliding rather than shrinking when it would run past today or before the oldest data.
 */
export function zoomViewport(vp: Viewport, factor: number, focus: number, bounds: ViewportBounds): Viewport {
  const span = vp.endDay - vp.startDay + 1
  const next = clampSpan(Math.round(span / factor), bounds)
  const f = Math.min(Math.max(focus, 0), 1)
  const focusDay = vp.startDay + f * (span - 1)
  return shiftInside(Math.round(focusDay - f * (next - 1)), next, bounds)
}

/** Slides the window by `deltaDays` (negative is earlier), stopping at the bounds. */
export function panViewport(vp: Viewport, deltaDays: number, bounds: ViewportBounds): Viewport {
  const span = vp.endDay - vp.startDay + 1
  return shiftInside(vp.startDay + Math.round(deltaDays), span, bounds)
}

/**
 * The resolution a window's width calls for: days up to 100, weeks up to two years, months beyond.
 * Past 100 a bar per day turns into hundreds of slivers; past two years, a bar per week does.
 */
export function granularityFor(spanDays: number): Granularity {
  if (spanDays <= 100) return 'day'
  if (spanDays <= 730) return 'week'
  return 'month'
}

/** The last day of the bucket starting on `startIso`. */
function bucketEndDay(startIso: string, granularity: Granularity): number {
  const start = dayOf(startIso)
  if (granularity === 'day') return start
  if (granularity === 'week') return start + 6
  const year = Number(startIso.slice(0, 4))
  const month = Number(startIso.slice(5, 7))
  return Math.floor(Date.UTC(year, month, 1) / MS_PER_DAY) - 1
}

/** Points whose span overlaps the window — a week or month that began before it included. */
export function visiblePoints<T extends { start: string }>(points: T[], granularity: Granularity, vp: Viewport): T[] {
  return points.filter((p) => dayOf(p.start) <= vp.endDay && bucketEndDay(p.start, granularity) >= vp.startDay)
}

/**
 * How far past today the window may be dragged, for a window `spanDays` wide: a fifth of it, at
 * least two days. The empty stretch after the live dot is breathing room, like the gap after the
 * last price on a stock chart — and it has to scale, or a year view could barely move.
 */
export function futureBuffer(spanDays: number): number {
  return Math.max(2, Math.round(spanDays * 0.2))
}

function isoOf(day: number): string {
  return new Date(day * MS_PER_DAY).toISOString().slice(0, 10)
}

/**
 * The buckets the window covers — the first one's number and how many — future ones included. The
 * chart lays its points out against these rather than against the data, so a window running past
 * today leaves empty slots on the right instead of stretching the last point to the edge.
 */
export function viewportBuckets(vp: Viewport, granularity: Granularity): { first: number; count: number } {
  const first = bucketOf(isoOf(vp.startDay), granularity)
  const last = bucketOf(isoOf(vp.endDay), granularity)
  return { first, count: last - first + 1 }
}
