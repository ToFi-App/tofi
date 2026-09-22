import { describe, expect, it } from 'vitest'
import { computeNetWorthHistory, netWorthYearRange } from './netWorthHistory'
import type { FeedItem } from '@/lib/transactions/resolveFeed'

const TODAY = new Date('2026-08-05T12:00:00Z')
const LINKED = new Set(['checking', 'card'])

function txn(overrides: Partial<FeedItem> & { date: string; amount: number }): FeedItem {
  return {
    id: `${overrides.date}-${overrides.amount}`,
    source: 'plaid',
    merchantName: 'Test',
    categoryId: null,
    subcategoryId: null,
    categorySource: 'uncategorized',
    confidenceLevel: null,
    pfcDetailed: null,
    accountId: 'checking',
    pending: false,
    note: null,
    reimbursedAmount: null,
    netAmount: null,
    isReimbursementIncome: false,
    reimbursementCategoryId: null,
    transferId: null,
    transferKind: null,
    transferRole: null,
    transferSource: null,
    isBrokerageCashAccount: false,
    isSweptOutflow: false,
    hasCrossAccountCounterpart: false,
    links: [],
    ...overrides,
    // Tracks `date`: these cases care about the display/bucketing date, and letting the
    // two drift would quietly change what any proximity assertion means.
    postedDate: overrides.postedDate ?? overrides.date,
  }
}

describe('computeNetWorthHistory', () => {
  it('walks backwards from the current balance, undoing each month of activity', () => {
    // Net worth is 1000 today. July spent 200 net, June earned 500 net.
    const feed = [
      txn({ date: '2026-07-15', amount: 200 }),
      txn({ date: '2026-06-10', amount: -500 }),
    ]
    const points = computeNetWorthHistory(1000, feed, LINKED, 2026, TODAY)

    expect(points.map((p) => [p.month, p.netWorth, p.change])).toEqual([
      [6, 1200, 500], // June ended at 1200 after +500
      [7, 1000, -200], // July's 200 of spending took it to 1000
      [8, 1000, 0], // August has no activity yet
    ])
  })

  it('treats money leaving an account as a net worth decrease regardless of account type', () => {
    // A card payment: 50 out of checking, 50 off the card balance. Net worth is unchanged,
    // so the previous month must land on the same value as today.
    const feed = [
      txn({ date: '2026-07-20', amount: 50, accountId: 'checking' }),
      txn({ date: '2026-07-20', amount: -50, accountId: 'card', id: 'card-payment' }),
    ]
    const points = computeNetWorthHistory(-250.37, feed, LINKED, 2026, TODAY)

    expect(points.find((p) => p.month === 7)?.netWorth).toBe(-250.37)
    expect(points.find((p) => p.month === 7)?.change).toBe(0)
  })

  it('counts manual transactions, anchoring the cash they moved on today', () => {
    // A $300 cash expense in July reads as "that money was still on hand in June" — it lifts
    // the earlier value rather than today's, which stays pinned to real balances. The June
    // Plaid deposit is only here to pull the walk back far enough to show June.
    const feed = [
      txn({ date: '2026-07-01', amount: 300, accountId: null, source: 'manual' }),
      txn({ date: '2026-06-01', amount: -500 }),
    ]
    const points = computeNetWorthHistory(1000, feed, LINKED, 2026, TODAY)

    expect(points.map((p) => [p.month, p.netWorth, p.change])).toEqual([
      [6, 1300, 500],
      [7, 1000, -300], // the manual expense, and nothing else, moved July
      [8, 1000, 0],
    ])
  })

  it('drops Plaid transactions whose account is no longer linked', () => {
    const feed = [txn({ date: '2026-07-02', amount: 400, accountId: 'unlinked-account' })]
    const points = computeNetWorthHistory(1000, feed, LINKED, 2026, TODAY)

    expect(points.every((p) => p.change === 0)).toBe(true)
    expect(points.every((p) => p.netWorth === 1000)).toBe(true)
  })

  it('omits months earlier than the oldest synced transaction rather than flat-lining them', () => {
    const feed = [txn({ date: '2026-05-10', amount: 100 })]
    const points = computeNetWorthHistory(900, feed, LINKED, 2026, TODAY)

    expect(points.map((p) => p.month)).toEqual([5, 6, 7, 8])
  })

  it('carries the walk across a year boundary and returns only the requested year', () => {
    const feed = [
      txn({ date: '2026-03-01', amount: 100 }),
      txn({ date: '2025-11-01', amount: -400 }),
    ]

    const y2026 = computeNetWorthHistory(1000, feed, LINKED, 2026, TODAY)
    expect(y2026[0]).toMatchObject({ month: 1, netWorth: 1100 })

    const y2025 = computeNetWorthHistory(1000, feed, LINKED, 2025, TODAY)
    expect(y2025.map((p) => [p.month, p.netWorth])).toEqual([
      [11, 1100],
      [12, 1100],
    ])
  })

  it('returns nothing for years outside the reconstructable range', () => {
    const feed = [txn({ date: '2026-06-01', amount: 100 })]
    expect(computeNetWorthHistory(1000, feed, LINKED, 2027, TODAY)).toEqual([])
    expect(computeNetWorthHistory(1000, feed, LINKED, 2024, TODAY)).toEqual([])
  })

  it('still reports the current month when there is no transaction history at all', () => {
    const points = computeNetWorthHistory(500, [], LINKED, 2026, TODAY)
    expect(points).toEqual([{ year: 2026, month: 8, netWorth: 500, change: 0 }])
  })

  it('rounds to cents so repeated subtraction does not leak float noise', () => {
    const feed = [
      txn({ date: '2026-07-01', amount: 0.1 }),
      txn({ date: '2026-06-01', amount: 0.2 }),
    ]
    for (const point of computeNetWorthHistory(10, feed, LINKED, 2026, TODAY)) {
      expect(point.netWorth).toBe(Number(point.netWorth.toFixed(2)))
      expect(point.change).toBe(Number(point.change.toFixed(2)))
    }
  })
})

describe('netWorthYearRange', () => {
  it('spans the oldest synced transaction through the current year', () => {
    const feed = [txn({ date: '2024-02-01', amount: 10 }), txn({ date: '2026-01-01', amount: 10 })]
    expect(netWorthYearRange(feed, LINKED, TODAY)).toEqual({ first: 2024, last: 2026 })
  })

  it('extends back to the oldest manual transaction too', () => {
    const feed = [txn({ date: '2023-05-01', amount: 10, accountId: null, source: 'manual' })]
    expect(netWorthYearRange(feed, LINKED, TODAY)).toEqual({ first: 2023, last: 2026 })
  })

  it('collapses to the current year when nothing is reconstructable', () => {
    expect(netWorthYearRange([], LINKED, TODAY)).toEqual({ first: 2026, last: 2026 })
    expect(netWorthYearRange([txn({ date: '2024-02-01', amount: 10, accountId: 'unlinked' })], LINKED, TODAY)).toEqual({
      first: 2026,
      last: 2026,
    })
  })
})

describe('computeNetWorthHistory: investment-source rows', () => {
  const LINKED_WITH_IRA = new Set(['checking', 'card', 'ira'])
  const investment = (overrides: Partial<FeedItem> & { date: string; amount: number }): FeedItem =>
    txn({ source: 'investment', accountId: 'ira', isBrokerageCashAccount: true, ...overrides })

  // Every case carries a $50 July grocery as an anchor: it keeps July inside the walk (a month
  // with no counted flow at all is omitted rather than flat-lined) and gives the assertions a
  // known non-zero baseline, so "this row contributed nothing" is visible as -50.
  const anchor = txn({ date: '2026-07-20', amount: 50, accountId: 'checking' })


  it('cancels a contribution against its checking leg — both legs now exist', () => {
    // Both legs present: the checking outflow (+1000) and the investment-side arrival (-1000)
    // sum to zero, which is correct and better than counting the checking leg alone.
    const points = computeNetWorthHistory(
      50_000,
      [
        anchor,
        txn({ date: '2026-07-15', amount: 1000, accountId: 'checking' }),
        investment({ date: '2026-07-15', amount: -1000 }),
      ],
      LINKED_WITH_IRA,
      2026,
      TODAY,
    )
    expect(points.find((p) => p.month === 7)!.change).toBe(-50)
  })

  it('still counts an unpaired investment inflow, which really did add value', () => {
    const points = computeNetWorthHistory(
      50_000,
      [anchor, investment({ date: '2026-07-15', amount: -120 })],
      LINKED_WITH_IRA,
      2026,
      TODAY,
    )
    expect(points.find((p) => p.month === 7)!.change).toBe(70)
  })

  it('drops household money on an account that is no longer linked', () => {
    // Same rationale as the plaid case: that balance left the net worth total when the
    // institution was removed, so unwinding its history unwinds a phantom.
    const points = computeNetWorthHistory(
      50_000,
      [anchor, investment({ date: '2026-07-15', amount: -1000 })],
      LINKED,
      2026,
      TODAY,
    )
    expect(points.find((p) => p.month === 7)!.change).toBe(-50)
  })
})
