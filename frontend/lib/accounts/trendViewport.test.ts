import { describe, expect, it } from 'vitest'
import { futureBuffer, granularityFor, panViewport, rangeViewport, viewportBuckets, visiblePoints, zoomViewport } from './trendViewport'

const TODAY = 20_000 // a day number
const EARLIEST = TODAY - 700
const BOUNDS = { minDay: EARLIEST, maxDay: TODAY }

describe('rangeViewport', () => {
  it('ends today and reaches back by the range', () => {
    expect(rangeViewport('1W', TODAY, EARLIEST, TODAY - 250)).toEqual({ startDay: TODAY - 6, endDay: TODAY })
    expect(rangeViewport('3M', TODAY, EARLIEST, TODAY - 250)).toEqual({ startDay: TODAY - 89, endDay: TODAY })
    expect(rangeViewport('YTD', TODAY, EARLIEST, TODAY - 250)).toEqual({ startDay: TODAY - 250, endDay: TODAY })
  })

  it('starts ALL at the oldest data, and never starts a range before it', () => {
    expect(rangeViewport('ALL', TODAY, EARLIEST, TODAY - 250)).toEqual({ startDay: EARLIEST, endDay: TODAY })
    expect(rangeViewport('1Y', TODAY, TODAY - 100, TODAY - 250)).toEqual({ startDay: TODAY - 100, endDay: TODAY })
  })
})

describe('zoomViewport', () => {
  const vp = { startDay: TODAY - 99, endDay: TODAY } // 100 days

  it('zooms in about the focus point, keeping it where the fingers are', () => {
    // Doubling in, focused at the middle: 50 days, centred where the old middle was.
    const next = zoomViewport(vp, 2, 0.5, BOUNDS)
    expect(next.endDay - next.startDay + 1).toBe(50)
    expect((next.startDay + next.endDay) / 2).toBeCloseTo((vp.startDay + vp.endDay) / 2, 0)
  })

  it('zooms out, clamped to the history on both sides', () => {
    const next = zoomViewport(vp, 0.01, 0.5, BOUNDS)
    expect(next).toEqual({ startDay: EARLIEST, endDay: TODAY })
  })

  it('never goes closer than a week', () => {
    const next = zoomViewport(vp, 1000, 0.5, BOUNDS)
    expect(next.endDay - next.startDay + 1).toBe(7)
  })

  it('slides back inside the bounds rather than showing days past today', () => {
    const next = zoomViewport(vp, 0.5, 1, BOUNDS)
    expect(next.endDay).toBe(TODAY)
    expect(next.endDay - next.startDay + 1).toBe(200)
  })
})

describe('panViewport', () => {
  it('slides the window without changing its width', () => {
    expect(panViewport({ startDay: TODAY - 99, endDay: TODAY - 50 }, -10, BOUNDS)).toEqual({ startDay: TODAY - 109, endDay: TODAY - 60 })
  })

  it('stops at today and at the oldest data', () => {
    expect(panViewport({ startDay: TODAY - 99, endDay: TODAY }, 30, BOUNDS)).toEqual({ startDay: TODAY - 99, endDay: TODAY })
    expect(panViewport({ startDay: EARLIEST + 5, endDay: EARLIEST + 55 }, -30, BOUNDS)).toEqual({ startDay: EARLIEST, endDay: EARLIEST + 50 })
  })
})

describe('granularityFor', () => {
  it('uses days up to 100, weeks up to two years, months beyond', () => {
    expect(granularityFor(90)).toBe('day')
    expect(granularityFor(100)).toBe('day')
    expect(granularityFor(365)).toBe('week')
    expect(granularityFor(731)).toBe('month')
  })
})

describe('visiblePoints', () => {
  const day = (iso: string) => Math.floor(Date.parse(`${iso}T00:00:00Z`) / 86_400_000)
  const pts = ['2026-06-29', '2026-07-06', '2026-07-13', '2026-07-20'].map((start) => ({ start }))

  it('keeps every point whose span overlaps the window — a week that started before it included', () => {
    const vp = { startDay: day('2026-07-08'), endDay: day('2026-07-15') }
    expect(visiblePoints(pts, 'week', vp).map((p) => p.start)).toEqual(['2026-07-06', '2026-07-13'])
  })
})

describe('futureBuffer', () => {
  it('lets the window run a fifth of its width past today, at least two days', () => {
    expect(futureBuffer(100)).toBe(20)
    expect(futureBuffer(7)).toBe(2)
  })
})

describe('viewportBuckets', () => {
  const day = (iso: string) => Math.floor(Date.parse(`${iso}T00:00:00Z`) / 86_400_000)

  it('counts the days in a daily window, future days included', () => {
    const { first, count } = viewportBuckets({ startDay: day('2026-09-20'), endDay: day('2026-10-01') }, 'day')
    expect(first).toBe(day('2026-09-20'))
    expect(count).toBe(12)
  })

  it('counts every week the window touches', () => {
    // Wed Sep 2 through Tue Sep 15: the weeks of Aug 31, Sep 7 and Sep 14.
    expect(viewportBuckets({ startDay: day('2026-09-02'), endDay: day('2026-09-15') }, 'week').count).toBe(3)
  })

  it('counts every month the window touches', () => {
    expect(viewportBuckets({ startDay: day('2026-01-15'), endDay: day('2026-03-02') }, 'month').count).toBe(3)
  })
})
