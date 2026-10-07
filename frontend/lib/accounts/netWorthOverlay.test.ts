import { describe, expect, it } from 'vitest'
import { overlayAccountHistories } from './netWorthHistory'
import type { TrendPoint } from './netWorthHistory'

// The walk's view of two accounts over five days: an investment account it can only see deposits
// for (a $500 deposit on Jan 2, growth carried flat), and a checking account.
function walk(): TrendPoint[] {
  const inv = [500, 1000, 1000, 1000, 1000]
  const invStart = [500, 500, 1000, 1000, 1000]
  return ['2025-01-01', '2025-01-02', '2025-01-03', '2025-01-04', '2025-01-05'].map((start, i) => ({
    bucket: i,
    start,
    balances: new Map([
      ['inv', inv[i]],
      ['chk', 300],
    ]),
    startBalances: new Map([
      ['inv', invStart[i]],
      ['chk', 300],
    ]),
    flow: new Map(),
  }))
}

// The rebuilt investment series, which only reaches back to Jan 3 and sees the market.
const rebuilt = [
  { date: '2025-01-03', value: 900, netDeposits: 0 },
  { date: '2025-01-04', value: 950, netDeposits: 0 },
  { date: '2025-01-05', value: 1000, netDeposits: 0 },
]

describe('overlayAccountHistories', () => {
  it('replaces an account’s band with its rebuilt value inside the rebuilt range', () => {
    const points = overlayAccountHistories(walk(), new Map([['inv', rebuilt]]))

    expect(points.slice(2).map((p) => p.balances.get('inv'))).toEqual([900, 950, 1000])
    expect(points.slice(2).map((p) => p.startBalances.get('inv'))).toEqual([900, 900, 950])
  })

  it('before the rebuilt range, joins the rebuilt start and moves only by the walk’s own transfers', () => {
    const points = overlayAccountHistories(walk(), new Map([['inv', rebuilt]]))

    // Jan 2: the walk reads the same as at Jan 3, so the band sits on the rebuilt start: 900.
    // Jan 1: the walk is $500 lower (before the deposit), so the band is too: 400.
    expect(points.slice(0, 2).map((p) => p.balances.get('inv'))).toEqual([400, 900])
    expect(points.slice(0, 2).map((p) => p.startBalances.get('inv'))).toEqual([400, 400])
  })

  it('leaves accounts with no rebuilt series as the walk drew them', () => {
    const points = overlayAccountHistories(walk(), new Map([['inv', rebuilt]]))

    expect(points.map((p) => p.balances.get('chk'))).toEqual([300, 300, 300, 300, 300])
  })

  it('carries a rebuilt value over days with no point of its own', () => {
    const sparse = [
      { date: '2025-01-03', value: 900, netDeposits: 0 },
      { date: '2025-01-05', value: 1000, netDeposits: 0 },
    ]
    const points = overlayAccountHistories(walk(), new Map([['inv', sparse]]))

    expect(points[3].balances.get('inv')).toBe(900)
  })
})
