import { describe, expect, it } from 'vitest'
import { currentMonth, filterByMonth, monthLabel, shiftMonth } from './filterByMonth'
import type { FeedItem } from './resolveFeed'

function item(date: string): FeedItem {
  return {
    id: date, source: 'plaid', amount: 10, date, postedDate: date, merchantName: 'x', categoryId: null, subcategoryId: null,
    categorySource: 'uncategorized', confidenceLevel: null, pfcDetailed: null, accountId: null, pending: false, note: null,
    reimbursedAmount: null, netAmount: null, isReimbursementIncome: false, reimbursementCategoryId: null,
    transferId: null, transferKind: null, transferRole: null, transferSource: null,
    isBrokerageCashAccount: false,
    isSweptOutflow: false,
    hasCrossAccountCounterpart: false,
    links: [],
  }
}

describe('filterByMonth', () => {
  it('keeps only items whose date falls within the given year/month', () => {
    const feed = [item('2026-06-30'), item('2026-06-01'), item('2026-07-01'), item('2025-06-15')]
    const result = filterByMonth(feed, { year: 2026, month: 6 })
    expect(result.map((i) => i.date)).toEqual(['2026-06-30', '2026-06-01'])
  })

  it('returns an empty array when nothing matches', () => {
    expect(filterByMonth([item('2026-01-01')], { year: 2026, month: 6 })).toEqual([])
  })
})

describe('shiftMonth', () => {
  it('moves forward a month, rolling over into the next year at December', () => {
    expect(shiftMonth({ year: 2026, month: 12 }, 1)).toEqual({ year: 2027, month: 1 })
    expect(shiftMonth({ year: 2026, month: 6 }, 1)).toEqual({ year: 2026, month: 7 })
  })

  it('moves backward a month, rolling under into the previous year at January', () => {
    expect(shiftMonth({ year: 2026, month: 1 }, -1)).toEqual({ year: 2025, month: 12 })
    expect(shiftMonth({ year: 2026, month: 6 }, -1)).toEqual({ year: 2026, month: 5 })
  })
})

describe('monthLabel', () => {
  it('formats as "Month YYYY"', () => {
    expect(monthLabel({ year: 2026, month: 6 })).toBe('June 2026')
    expect(monthLabel({ year: 2026, month: 12 })).toBe('December 2026')
  })
})

describe('currentMonth', () => {
  it('returns a {year, month} matching today', () => {
    const now = new Date()
    expect(currentMonth()).toEqual({ year: now.getFullYear(), month: now.getMonth() + 1 })
  })
})
