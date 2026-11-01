import { describe, expect, it } from 'vitest'
import { arrangeTiles, packRows, tileState } from './categoryTiles'

describe('tileState', () => {
  it('is unbudgeted without a budget, and the budget status with one', () => {
    expect(tileState(10, null, 0.5)).toBe('unbudgeted')
    expect(tileState(500, 400, 0.5)).toBe('over')
  })
})

describe('arrangeTiles', () => {
  it('puts problems first, then the rest by size', () => {
    const tiles = arrangeTiles(
      [
        { id: 'bills', spent: 1000, state: 'unbudgeted' as const },
        { id: 'shop', spent: 400, state: 'over' as const },
        { id: 'food', spent: 500, state: 'at-risk' as const },
        { id: 'fun', spent: 60, state: 'on-track' as const },
      ],
      1960,
    )
    expect(tiles.map((t) => t.id)).toEqual(['shop', 'food', 'bills', 'fun'])
  })

  it('widens the two biggest categories, only if they are a real share of the month', () => {
    const tiles = arrangeTiles(
      [
        { id: 'a', spent: 500, state: 'unbudgeted' as const },
        { id: 'b', spent: 300, state: 'unbudgeted' as const },
        { id: 'c', spent: 200, state: 'unbudgeted' as const },
        { id: 'd', spent: 100, state: 'unbudgeted' as const },
      ],
      1100,
    )
    expect(tiles.filter((t) => t.wide).map((t) => t.id)).toEqual(['a', 'b'])
  })
})

describe('packRows', () => {
  const t = (id: string, wide = false) => ({ id, wide })

  it('backfills the gap a wide tile leaves at the end of a row', () => {
    const rows = packRows([t('a'), t('b'), t('w', true), t('c')])
    expect(rows.map((r) => r.map((x) => x.id))).toEqual([['a', 'b', 'c'], ['w']])
  })

  it('alternates which side a wide tile sits on', () => {
    const rows = packRows([t('w1', true), t('a'), t('w2', true), t('b')])
    expect(rows.map((r) => r.map((x) => x.id))).toEqual([['w1', 'a'], ['b', 'w2']])
  })
})
