import { describe, expect, it } from 'vitest'
import { fittedExtent, formatAxisAmount, formatTick, monotoneLine, niceExtent, niceScale, skewedExtent, smoothLine } from './lineChart'

describe('niceScale', () => {
  it('produces a top tick that covers the max', () => {
    for (const max of [0.42, 1, 3, 7.5, 26.53, 42.42, 99, 100, 1100, 12345]) {
      const ticks = niceScale(max)
      expect(ticks[ticks.length - 1]).toBeGreaterThanOrEqual(max)
    }
  })

  it('extends past the last round step instead of truncating below the max', () => {
    // 1100 used to snap to [0..1000], pushing the peak above the plot.
    expect(niceScale(1100)).toEqual([0, 200, 400, 600, 800, 1000, 1200])
    expect(niceScale(26.53)).toEqual([0, 5, 10, 15, 20, 25, 30])
  })

  it('keeps fractional ticks distinct for small amounts', () => {
    const ticks = niceScale(3)
    expect(ticks).toEqual([0, 0.5, 1, 1.5, 2, 2.5, 3])
    expect(new Set(ticks).size).toBe(ticks.length)
  })

  // SpendingTrend relies on both of these: it reads ticks[1] as the step, and
  // uses the tick value as a React key.
  it('always returns at least two strictly increasing ticks starting at zero', () => {
    for (const max of [0.07, 2.4, 18, 640, 0, -5, NaN]) {
      const ticks = niceScale(max)
      expect(ticks.length).toBeGreaterThanOrEqual(2)
      expect(ticks[0]).toBe(0)
      for (let i = 1; i < ticks.length; i++) expect(ticks[i]).toBeGreaterThan(ticks[i - 1])
    }
  })

  it('does not drift on fractional steps', () => {
    for (const tick of niceScale(0.5)) {
      expect(tick).toBeCloseTo(Number(tick.toFixed(2)), 10)
    }
  })

  it('falls back to a 0-1 domain for empty or invalid input', () => {
    expect(niceScale(0)).toEqual([0, 1])
    expect(niceScale(-5)).toEqual([0, 1])
    expect(niceScale(NaN)).toEqual([0, 1])
  })
})

describe('formatTick', () => {
  it('shows whole numbers for integer steps', () => {
    expect(formatTick(0, 5)).toBe('0')
    expect(formatTick(25, 5)).toBe('25')
  })

  it('shows decimals for fractional steps', () => {
    expect(formatTick(0.5, 0.5)).toBe('0.5')
    expect(formatTick(0.06, 0.02)).toBe('0.06')
  })

  it('abbreviates thousands', () => {
    expect(formatTick(1000, 200)).toBe('1K')
    expect(formatTick(1200, 200)).toBe('1.2K')
  })
})

describe('niceExtent', () => {
  it('covers the full data range on both sides', () => {
    for (const [min, max] of [[-250.37, 0], [0, 73000], [-1200, 4800], [12, 12]] as const) {
      const ticks = niceExtent(min, max)
      expect(ticks[0]).toBeLessThanOrEqual(Math.min(min, 0))
      expect(ticks[ticks.length - 1]).toBeGreaterThanOrEqual(Math.max(max, 0))
    }
  })

  // The area fill hangs from the zero line, so zero has to be an actual gridline.
  it('always includes zero as a tick', () => {
    for (const [min, max] of [[-250.37, 0], [0, 73000], [-1200, 4800], [-9, -3]] as const) {
      expect(niceExtent(min, max)).toContain(0)
    }
  })

  it('returns strictly increasing ticks', () => {
    const ticks = niceExtent(-1200, 4800)
    expect(ticks.length).toBeGreaterThanOrEqual(2)
    for (let i = 1; i < ticks.length; i++) expect(ticks[i]).toBeGreaterThan(ticks[i - 1])
  })

  it('falls back to a 0-1 domain when there is no span to scale', () => {
    expect(niceExtent(0, 0)).toEqual([0, 1])
    expect(niceExtent(NaN, NaN)).toEqual([0, 1])
  })
})

describe('formatAxisAmount', () => {
  it('abbreviates thousands and millions', () => {
    expect(formatAxisAmount(0)).toBe('0')
    expect(formatAxisAmount(24000)).toBe('24K')
    expect(formatAxisAmount(1500)).toBe('1.5K')
    expect(formatAxisAmount(2_400_000)).toBe('2.4M')
  })

  it('keeps the sign outside the abbreviation', () => {
    expect(formatAxisAmount(-1500)).toBe('-1.5K')
    expect(formatAxisAmount(-200)).toBe('-200')
    expect(formatAxisAmount(-2.5)).toBe('-2.5')
  })
})

describe('smoothLine', () => {
  it('keeps control points inside the plot bounds', () => {
    // A sharp spike whose Catmull-Rom handles would otherwise overshoot above y=0.
    const pts = [
      { x: 0, y: 100 },
      { x: 10, y: 100 },
      { x: 20, y: 0 },
      { x: 30, y: 100 },
      { x: 40, y: 100 },
    ]
    const d = smoothLine(pts, 0, 100)
    const ys = [...d.matchAll(/-?[\d.]+ (-?[\d.]+)/g)].map((m) => Number(m[1]))
    expect(ys.length).toBeGreaterThan(0)
    for (const y of ys) {
      expect(y).toBeGreaterThanOrEqual(0)
      expect(y).toBeLessThanOrEqual(100)
    }
  })

  it('handles degenerate point counts', () => {
    expect(smoothLine([], 0, 100)).toBe('')
    expect(smoothLine([{ x: 0, y: 1 }], 0, 100)).toBe('')
    expect(smoothLine([{ x: 0, y: 1 }, { x: 5, y: 9 }], 0, 100)).toBe('M 0 1 L 5 9')
  })
})

describe('skewedExtent', () => {
  it('reaches just past a small negative instead of a whole negative step', () => {
    // $400 below zero against $58K above: a full -20K step would be a third of the chart empty.
    const { min, max, ticks } = skewedExtent(-400, 58_000, 3)
    expect(max).toBe(60_000)
    expect(min).toBeCloseTo(-460)
    expect(ticks).toEqual([0, 20_000, 40_000, 60_000])
  })

  it('labels the negative side in whole steps once it is at least a step deep', () => {
    const { min, ticks } = skewedExtent(-25_000, 58_000, 3)
    expect(min).toBe(-40_000)
    expect(ticks).toEqual([-40_000, -20_000, 0, 20_000, 40_000, 60_000])
  })

  it('has no negative side at all when nothing is below zero', () => {
    expect(skewedExtent(0, 58_000, 3)).toEqual({ min: 0, max: 60_000, ticks: [0, 20_000, 40_000, 60_000] })
  })

  it('falls back to the two-sided scale when everything is at or below zero', () => {
    const { min, max, ticks } = skewedExtent(-5_000, 0, 3)
    expect(max).toBe(0)
    expect(min).toBeLessThanOrEqual(-5_000)
    expect(ticks[ticks.length - 1]).toBe(0)
  })
})

describe('fittedExtent', () => {
  it('fits the data, not zero, with a margin on each side', () => {
    expect(fittedExtent([50_000, 60_000], 0.1)).toEqual({ min: 49_000, max: 61_000 })
  })

  it('gives a flat series a band around its value instead of a zero-height range', () => {
    expect(fittedExtent([500, 500], 0.1)).toEqual({ min: 499, max: 501 })
  })

  it('is a unit range with no data', () => {
    expect(fittedExtent([], 0.1)).toEqual({ min: 0, max: 1 })
  })
})

describe('fittedExtent: minimum span', () => {
  it('widens a tiny range to the minimum span, centred on the data', () => {
    // A $50 wobble on $58K shouldn't fill the chart: at least 2% of the value is shown.
    const { min, max } = fittedExtent([58_000, 58_050], 0.1, 58_025 * 0.02)
    expect(max - min).toBeCloseTo(58_025 * 0.02)
    expect((min + max) / 2).toBeCloseTo(58_025)
  })

  it('leaves a range already wider than the minimum alone', () => {
    expect(fittedExtent([40_000, 60_000], 0.1, 1000)).toEqual({ min: 38_000, max: 62_000 })
  })
})

describe('monotoneLine', () => {
  const controlYs = (d: string) =>
    [...d.matchAll(/C ([\d.-]+) ([\d.-]+) ([\d.-]+) ([\d.-]+) ([\d.-]+) ([\d.-]+)/g)].flatMap((m) => [Number(m[2]), Number(m[4])])

  it('never bulges past a flat stretch — no hump above two equal points', () => {
    const d = monotoneLine([
      { x: 0, y: 50 },
      { x: 10, y: 10 },
      { x: 20, y: 10 },
      { x: 30, y: 60 },
    ])
    for (const y of controlYs(d)) expect(y).toBeGreaterThanOrEqual(10)
  })

  it('keeps every segment between its own endpoints', () => {
    const pts = [
      { x: 0, y: 100 },
      { x: 10, y: 20 },
      { x: 20, y: 30 },
      { x: 30, y: 25 },
    ]
    const ys = controlYs(monotoneLine(pts))
    for (let i = 0; i < pts.length - 1; i++) {
      const lo = Math.min(pts[i].y, pts[i + 1].y)
      const hi = Math.max(pts[i].y, pts[i + 1].y)
      for (const y of ys.slice(i * 2, i * 2 + 2)) {
        expect(y).toBeGreaterThanOrEqual(lo - 1e-9)
        expect(y).toBeLessThanOrEqual(hi + 1e-9)
      }
    }
  })

  it('draws a straight segment for two points and nothing for one', () => {
    expect(monotoneLine([{ x: 0, y: 0 }, { x: 10, y: 5 }])).toBe('M 0 0 L 10 5')
    expect(monotoneLine([{ x: 0, y: 0 }])).toBe('')
  })
})

describe('slotX', () => {
  it('puts the window’s first slot on the left edge and its last at the right, less the inset', async () => {
    const { slotX } = await import('./lineChart')
    // 7 slots across 400 with an 8 inset: 6 gaps over 392.
    expect(slotX(0, 7, 400, 8)).toBe(0)
    expect(slotX(6, 7, 400, 8)).toBe(392)
    expect(slotX(3, 7, 400, 8)).toBe(196)
  })

  it('places a lone slot at the right, where the latest point belongs', async () => {
    const { slotX } = await import('./lineChart')
    expect(slotX(0, 1, 400, 8)).toBe(392)
  })
})

describe('slotAt', () => {
  it('reads the nearest slot under a finger, inside the window', async () => {
    const { slotAt } = await import('./lineChart')
    expect(slotAt(0, 7, 400, 8)).toBe(0)
    expect(slotAt(100, 7, 400, 8)).toBe(2) // 100 / 65.3 = 1.53, nearest 2
    expect(slotAt(392, 7, 400, 8)).toBe(6)
    expect(slotAt(-20, 7, 400, 8)).toBe(0)
    expect(slotAt(1000, 7, 400, 8)).toBe(6)
  })
})
