import { describe, expect, it } from 'vitest'
import { investmentHeadlineGain, netPrincipal, totalReturn } from './principal'
import type { Holding } from '@/types/domain'
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

describe('totalReturn', () => {
  it('is value minus net deposits, as a share of those deposits', () => {
    expect(totalReturn(43_625.93, 28_194.85)).toEqual({ gain: 15_431.08, pct: 15_431.08 / 28_194.85 })
  })

  it('reports a loss as a negative return', () => {
    expect(totalReturn(900, 1000)).toEqual({ gain: -100, pct: -0.1 })
  })

  it('has no percentage when more has been taken out than put in', () => {
    expect(totalReturn(500, -200)).toEqual({ gain: 700, pct: null })
  })

  it('is null with no transfers to measure against', () => {
    expect(totalReturn(500, null)).toBeNull()
  })
})

describe('investmentHeadlineGain', () => {
  const holding = (overrides: Partial<Holding>): Holding =>
    ({ securityId: 's', type: 'equity', institutionValue: 100, costBasis: 80, ...overrides }) as Holding

  it('is total return while more has been deposited than withdrawn', () => {
    expect(investmentHeadlineGain(1200, 1000, [holding({})])).toEqual({ gain: 200, pct: 0.2 })
  })

  it('falls back to unrealized gain once withdrawals exceed deposits — total return has no base', () => {
    const result = investmentHeadlineGain(54.71, -6942.07, [
      holding({ institutionValue: 34.69, costBasis: 29 }),
      holding({ securityId: 'usd', type: 'cash', institutionValue: 20.02, costBasis: null }),
    ])
    expect(result?.gain).toBe(5.69)
    expect(result?.pct).toBeCloseTo(5.69 / 29, 10)
  })

  it('falls back to unrealized gain when there are no transfers at all', () => {
    expect(investmentHeadlineGain(100, null, [holding({})])).toEqual({ gain: 20, pct: 0.25 })
  })

  it('is null when the fallback has no usable cost basis either', () => {
    expect(investmentHeadlineGain(100, null, [holding({ costBasis: null })])).toBeNull()
  })
})
