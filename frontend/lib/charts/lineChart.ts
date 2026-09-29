/** Pure scale/path math for the spending trend chart. No React Native imports. */

/**
 * Gridline values from 0 up to at least `max`, snapped to 1/2/5 x 10^n steps.
 * The top tick always covers `max`, so callers can use it as the y-domain
 * without the data overflowing the plot.
 */
export function niceScale(max: number, ticks = 5): number[] {
  if (!Number.isFinite(max) || max <= 0) return [0, 1]
  const rough = max / ticks
  const mag = Math.pow(10, Math.floor(Math.log10(rough)))
  const r = rough / mag
  const step = r <= 1.5 ? mag : r <= 3 ? 2 * mag : r <= 7 ? 5 * mag : 10 * mag
  // Round up so the top tick always covers the data, and multiply rather than
  // accumulate so fractional steps don't drift.
  const count = Math.ceil(max / step - 1e-9)
  const result: number[] = []
  for (let i = 0; i <= count; i++) result.push(i * step)
  return result
}

/**
 * Gridline values spanning a signed range, snapped to 1/2/5 x 10^n steps. Unlike
 * `niceScale` the domain is two-sided, for series that can go negative (net worth with
 * more liabilities than assets). Zero is always a tick, so the baseline a filled area
 * hangs from is a real gridline rather than an implied one.
 */
export function niceExtent(min: number, max: number, tickCount = 4): number[] {
  const lo = Math.min(0, Number.isFinite(min) ? min : 0)
  const hi = Math.max(0, Number.isFinite(max) ? max : 0)
  const span = hi - lo
  if (span <= 0) return [0, 1]
  const rough = span / tickCount
  const mag = Math.pow(10, Math.floor(Math.log10(rough)))
  const r = rough / mag
  const step = r <= 1.5 ? mag : r <= 3 ? 2 * mag : r <= 7 ? 5 * mag : 10 * mag
  // Multiply out from an integer index rather than accumulating, so fractional steps
  // don't drift — the same reason `niceScale` does it this way.
  const first = Math.floor(lo / step + 1e-9)
  const last = Math.ceil(hi / step - 1e-9)
  const result: number[] = []
  for (let i = first; i <= last; i++) result.push(i * step)
  return result
}

/**
 * A two-sided domain that doesn't give a small negative a whole step. `niceExtent` rounds both
 * ends to the same step, so a few hundred dollars below zero under a $60K chart buys a full -20K
 * band — a third of the plot left empty. Here only the positive side is stepped; the negative side
 * reaches just past the actual minimum (15% padding) until it is at least one step deep, and only
 * then is stepped and labelled too.
 *
 * `ticks` are the labelled values; `min`/`max` are the domain to scale against, which below zero
 * may be an unlabelled value between ticks. All-negative data falls back to niceExtent.
 */
export function skewedExtent(min: number, max: number, tickCount = 4): { min: number; max: number; ticks: number[] } {
  const lo = Math.min(0, Number.isFinite(min) ? min : 0)
  const hi = Math.max(0, Number.isFinite(max) ? max : 0)
  if (hi <= 0) {
    const ticks = niceExtent(lo, 0, tickCount)
    return { min: ticks[0], max: 0, ticks }
  }
  const positive = niceExtent(0, hi, tickCount)
  const top = positive[positive.length - 1]
  const step = positive.length > 1 ? positive[1] - positive[0] : top
  if (lo >= 0) return { min: 0, max: top, ticks: positive }
  if (-lo < step) return { min: lo * 1.15, max: top, ticks: positive }
  const depth = Math.ceil(-lo / step - 1e-9)
  const negative: number[] = []
  for (let i = depth; i >= 1; i--) negative.push(-i * step)
  return { min: -depth * step, max: top, ticks: [...negative, ...positive] }
}

/**
 * A domain fitted to the data rather than anchored at zero, the way a stock chart scales its line:
 * the lowest and highest values, padded by `margin` of the range on each side. A flat series gets
 * ±1 so it draws mid-height instead of dividing by zero.
 *
 * `minSpan` stops a tiny range filling the chart: a week where net worth moved $50 would otherwise
 * draw as a cliff. The domain is widened to at least that span, centred on the data.
 */
export function fittedExtent(values: number[], margin = 0.1, minSpan = 0): { min: number; max: number } {
  const finite = values.filter(Number.isFinite)
  if (finite.length === 0) return { min: 0, max: 1 }
  const lo = Math.min(...finite)
  const hi = Math.max(...finite)
  let min = lo
  let max = hi
  if (hi === lo) {
    min = lo - 1
    max = hi + 1
  } else {
    const pad = (hi - lo) * margin
    min = lo - pad
    max = hi + pad
  }
  if (max - min < minSpan) {
    const mid = (lo + hi) / 2
    min = mid - minSpan / 2
    max = mid + minSpan / 2
  }
  return { min, max }
}

/**
 * A smooth curve through `pts` (ascending x) that never overshoots: monotone cubic interpolation
 * (Fritsch–Carlson). Each segment stays between its own endpoints, so a flat stretch stays flat and
 * no peak or dip appears that the data doesn't have — the flaw of plain Catmull-Rom smoothing,
 * which bulges past a turn.
 */
export function monotoneLine(pts: { x: number; y: number }[]): string {
  const n = pts.length
  if (n < 2) return ''
  if (n === 2) return `M ${pts[0].x} ${pts[0].y} L ${pts[1].x} ${pts[1].y}`

  const slopes: number[] = []
  for (let i = 0; i < n - 1; i++) {
    const dx = pts[i + 1].x - pts[i].x
    slopes.push(dx === 0 ? 0 : (pts[i + 1].y - pts[i].y) / dx)
  }
  const tangents: number[] = [slopes[0]]
  for (let i = 1; i < n - 1; i++) {
    const a = slopes[i - 1]
    const b = slopes[i]
    // A turn (or a flat side) gets a flat tangent: that is what keeps the curve from bulging.
    tangents.push(a * b <= 0 ? 0 : (a + b) / 2)
  }
  tangents.push(slopes[n - 2])

  for (let i = 0; i < n - 1; i++) {
    if (slopes[i] === 0) {
      tangents[i] = 0
      tangents[i + 1] = 0
      continue
    }
    const alpha = tangents[i] / slopes[i]
    const beta = tangents[i + 1] / slopes[i]
    const sum = alpha * alpha + beta * beta
    if (sum > 9) {
      const tau = 3 / Math.sqrt(sum)
      tangents[i] = tau * alpha * slopes[i]
      tangents[i + 1] = tau * beta * slopes[i]
    }
  }

  let d = `M ${pts[0].x} ${pts[0].y}`
  for (let i = 0; i < n - 1; i++) {
    const p0 = pts[i]
    const p1 = pts[i + 1]
    const h = (p1.x - p0.x) / 3
    d += ` C ${p0.x + h} ${p0.y + tangents[i] * h} ${p1.x - h} ${p1.y - tangents[i + 1] * h} ${p1.x} ${p1.y}`
  }
  return d
}

/** Compact axis label for a signed money value: -1.2K, 0, 24K, 1.5M. */
export function formatAxisAmount(v: number): string {
  const abs = Math.abs(v)
  const sign = v < 0 ? '-' : ''
  const trim = (n: number) => String(Math.round(n * 10) / 10)
  if (abs === 0) return '0'
  if (abs >= 1_000_000) return `${sign}${trim(abs / 1_000_000)}M`
  if (abs >= 1_000) return `${sign}${trim(abs / 1_000)}K`
  if (abs < 10) return `${sign}${trim(abs)}`
  return `${sign}${Math.round(abs)}`
}

export function formatTick(v: number, step: number): string {
  if (v >= 1000) return `${(v / 1000).toFixed(v % 1000 === 0 ? 0 : 1)}K`
  const decimals = step >= 1 ? 0 : step >= 0.1 ? 1 : 2
  return v.toFixed(decimals)
}

/**
 * Catmull-Rom-ish cubic bezier through `pts`. Control points are clamped to
 * [yMin, yMax]; since a cubic bezier stays inside the convex hull of its
 * control points, that keeps the smoothed curve from overshooting the plot.
 */
export function smoothLine(pts: { x: number; y: number }[], yMin: number, yMax: number): string {
  if (pts.length < 2) return ''
  if (pts.length === 2) return `M ${pts[0].x} ${pts[0].y} L ${pts[1].x} ${pts[1].y}`
  const clampY = (y: number) => Math.min(yMax, Math.max(yMin, y))
  let d = `M ${pts[0].x} ${pts[0].y}`
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[Math.max(0, i - 1)]
    const p1 = pts[i]
    const p2 = pts[i + 1]
    const p3 = pts[Math.min(pts.length - 1, i + 2)]
    const t = 6
    const c1y = clampY(p1.y + (p2.y - p0.y) / t)
    const c2y = clampY(p2.y - (p3.y - p1.y) / t)
    d += ` C ${p1.x + (p2.x - p0.x) / t} ${c1y} ${p2.x - (p3.x - p1.x) / t} ${c2y} ${p2.x} ${p2.y}`
  }
  return d
}
