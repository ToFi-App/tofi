import { describe, expect, it } from 'vitest'
import { activeDayAt, centredStripOffset, isScrolledToEnd, MIN_VISIBLE } from './dayStrip'

describe('activeDayAt', () => {
  // Newest first, as the list lays them out: each card 300pt tall, 12pt apart.
  const offsets = [
    { date: '2026-06-20', y: 500, height: 300 },
    { date: '2026-06-14', y: 812, height: 300 },
    { date: '2026-06-03', y: 1124, height: 300 },
  ]

  it('picks the topmost card still showing below the bar', () => {
    expect(activeDayAt(offsets, 600)).toBe('2026-06-20')
    expect(activeDayAt(offsets, 900)).toBe('2026-06-14')
  })

  it('passes over a card with only its last few points peeking out', () => {
    // 20 points of the first card left under the bar: it's been read.
    expect(activeDayAt(offsets, 780)).toBe('2026-06-14')
    expect(activeDayAt(offsets, 800 - MIN_VISIBLE)).toBe('2026-06-20')
  })

  it('holds the first card before the list is reached', () => {
    expect(activeDayAt(offsets, 100)).toBe('2026-06-20')
  })

  it('gives the last card its turn once scrolled to the end', () => {
    expect(activeDayAt(offsets, 900, true)).toBe('2026-06-03')
  })

  it('reads offsets in any order', () => {
    expect(activeDayAt([...offsets].reverse(), 900)).toBe('2026-06-14')
  })

  it('has nothing to pick from an empty list', () => {
    expect(activeDayAt([], 900)).toBeNull()
  })
})

describe('centredStripOffset', () => {
  // 31 days at 44pt in a 353pt view.
  it('centres the day in the view', () => {
    expect(centredStripOffset(15, 31, 44, 353)).toBe(15 * 44 + 22 - 176.5)
  })

  it('counts the padding at the strip\'s start', () => {
    expect(centredStripOffset(15, 31, 44, 353, 16)).toBe(16 + 15 * 44 + 22 - 176.5)
  })

  it('stops at either end of the strip', () => {
    expect(centredStripOffset(0, 31, 44, 353, 16)).toBe(0)
    expect(centredStripOffset(30, 31, 44, 353, 16)).toBe(31 * 44 + 32 - 353)
  })

  it('never scrolls a strip shorter than the view', () => {
    expect(centredStripOffset(3, 5, 44, 353)).toBe(0)
  })
})

describe('isScrolledToEnd', () => {
  it('is true within a couple of points of the bottom', () => {
    expect(isScrolledToEnd(5000 - 720 - 1, 720, 5000)).toBe(true)
    expect(isScrolledToEnd(4000, 720, 5000)).toBe(false)
  })

  it('is false before the sizes are known', () => {
    expect(isScrolledToEnd(0, 0, 0)).toBe(false)
  })
})
