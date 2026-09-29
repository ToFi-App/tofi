import { describe, expect, it } from 'vitest'
import { blendStops, dayHeat, daySquares } from './daySquares'

const colorOf = (id: string | null) => (id ? `#${id}` : '#none')

describe('daySquares', () => {
  it('orders a day’s categories largest first, shading each by its share of the day', () => {
    const { squares, more } = daySquares(new Map<string | null, number>([['b', 25], ['a', 75]]), colorOf)
    expect(squares).toEqual([
      { key: 'a', color: '#a', share: 0.75 },
      { key: 'b', color: '#b', share: 0.25 },
    ])
    expect(more).toBe(false)
  })

  it('shows four and flags the rest', () => {
    const day = new Map<string | null, number>([['a', 5], ['b', 4], ['c', 3], ['d', 2], ['e', 1]])
    const { squares, more } = daySquares(day, colorOf)
    expect(squares.map((s) => s.key)).toEqual(['a', 'b', 'c', 'd'])
    expect(more).toBe(true)
  })

  it('is empty for a day with no spending', () => {
    expect(daySquares(undefined, colorOf)).toEqual({ squares: [], more: false })
  })
})

describe('dayHeat', () => {
  // Feed convention: a positive net is money out (a spending day), negative is money in.
  const extremes = { biggestSpend: 200, biggestIncome: 2000 }

  it('shades a net spending day red, against the month’s biggest spending day', () => {
    expect(dayHeat(50, extremes)).toEqual({ tone: 'expense', intensity: 0.25 })
  })

  it('shades a net income day green, on its own scale so a paycheck doesn’t flatten spending', () => {
    expect(dayHeat(-500, extremes)).toEqual({ tone: 'income', intensity: 0.25 })
  })

  it('leaves a day with no net movement unshaded', () => {
    expect(dayHeat(0, extremes)).toEqual({ tone: 'expense', intensity: 0 })
    expect(dayHeat(null, extremes)).toEqual({ tone: 'expense', intensity: 0 })
  })
})

describe('blendStops', () => {
  it('places each colour at the middle of its share, so bigger categories hold more of the cell', () => {
    const stops = blendStops([
      { key: 'a', color: '#a', share: 0.5 },
      { key: 'b', color: '#b', share: 0.3 },
      { key: 'c', color: '#c', share: 0.2 },
    ])
    expect(stops).toEqual([
      { offset: 0, color: '#a' },
      { offset: 0.25, color: '#a' },
      { offset: 0.65, color: '#b' },
      { offset: 0.9, color: '#c' },
      { offset: 1, color: '#c' },
    ])
  })

  it('is a single flat colour for one category', () => {
    expect(blendStops([{ key: 'a', color: '#a', share: 1 }])).toEqual([
      { offset: 0, color: '#a' },
      { offset: 1, color: '#a' },
    ])
  })

  it('is empty with no categories', () => {
    expect(blendStops([])).toEqual([])
  })
})
