import { describe, expect, it } from 'vitest'
import { netPrincipal } from './principal'
import type { FeedItem } from '@/lib/transactions/resolveFeed'

function item(overrides: Partial<FeedItem> & Pick<FeedItem, 'id' | 'amount' | 'date'>): FeedItem {
  return {
    source: 'investment',
    merchantName: 'Electronic Funds Transfer',
    categoryId: null,
    subcategoryId: null,
    categorySource: 'uncategorized',
    confidenceLevel: null,
    pfcDetailed: null,
    accountId: 'brokerage',
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
    isBrokerageCashAccount: true,
    isSweptOutflow: false,
    hasCrossAccountCounterpart: false,
    links: [],
    ...overrides,
    // Tracks `date`: these cases care about the display/bucketing date, and letting the
    // two drift would quietly change what any proximity assertion means.
    postedDate: overrides.postedDate ?? overrides.date,
  }
}

// Feed convention: positive = money out. So a contribution is negative, a withdrawal positive.
const contribution = (id: string, dollars: number, date: string) => item({ id, amount: -dollars, date })
const withdrawal = (id: string, dollars: number, date: string) => item({ id, amount: dollars, date })

describe('netPrincipal', () => {
  it('sums contributions', () => {
    expect(netPrincipal([contribution('a', 2000, '2026-03-01'), contribution('b', 3000, '2026-04-01')])).toBe(5000)
  })

  it('subtracts withdrawals', () => {
    expect(netPrincipal([contribution('a', 5000, '2026-03-01'), withdrawal('b', 1200, '2026-04-01')])).toBe(3800)
  })

  it('goes negative when more came out than went in', () => {
    // Real for an account being drawn down: the growth is being spent, so net contributions is
    // below zero. Reporting 0 instead would be a lie in the flattering direction.
    expect(netPrincipal([contribution('a', 1000, '2026-03-01'), withdrawal('b', 4000, '2026-04-01')])).toBe(-3000)
  })


  it('returns null for an account with no transfers, so callers can omit the figure', () => {
    expect(netPrincipal([])).toBeNull()
  })

  it('returns null when the slice holds only non-investment rows', () => {
    expect(netPrincipal([item({ id: 'plaid-row', source: 'plaid', amount: -500, date: '2026-03-01' })])).toBeNull()
  })

  it('ignores plaid and manual rows, which would double-count the transfer that funded them', () => {
    const result = netPrincipal([
      contribution('a', 1000, '2026-03-01'),
      item({ id: 'plaid-row', source: 'plaid', amount: -5000, date: '2026-03-01' }),
      item({ id: 'manual-row', source: 'manual', amount: -9000, date: '2026-03-01' }),
    ])
    expect(result).toBe(1000)
  })

  it('counts a paired transfer exactly once — pairing does not change what was contributed', () => {
    // An auto-matched contribution is excluded from spend totals, but the money still went in.
    const paired = item({
      id: 'matched',
      amount: -2000,
      date: '2026-05-15',
      transferKind: 'account_transfer',
      transferRole: 'income',
    })
    expect(netPrincipal([paired])).toBe(2000)
  })

  it('handles cents without float drift', () => {
    const result = netPrincipal([
      contribution('a', 1001.22, '2026-05-06'),
      contribution('b', 2.11, '2026-05-07'),
      withdrawal('c', 3.33, '2026-05-08'),
    ])
    expect(result).toBeCloseTo(1000, 10)
  })
})
