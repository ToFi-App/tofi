import { describe, expect, it } from 'vitest'
import { compareDailySpend, compareWithPreviousMonth, cumulativeSpend } from './monthComparison'
import type { FeedItem } from '@/lib/transactions/resolveFeed'

function spend(id: string, date: string, amount: number): FeedItem {
  return {
    id, date, postedDate: date, amount, categoryId: 'food',
    source: 'plaid', merchantName: 'x', subcategoryId: null, categorySource: 'plaid_pfc',
    confidenceLevel: null, pfcDetailed: null, accountId: 'a', pending: false, note: null,
    reimbursedAmount: null, netAmount: null, isReimbursementIncome: false, reimbursementCategoryId: null,
    transferId: null, transferKind: null, transferRole: null, transferSource: null,
    isBrokerageCashAccount: false, isSweptOutflow: false, hasCrossAccountCounterpart: false, links: [],
  } as FeedItem
}

function days(amounts: number[]) {
  return amounts.map((amount, i) => ({ day: i + 1, amount }))
}

describe('cumulativeSpend', () => {
  it('turns daily spending into a running total', () => {
    expect(cumulativeSpend(days([10, 0, 5]))).toEqual([
      { day: 1, total: 10 },
      { day: 2, total: 10 },
      { day: 3, total: 15 },
    ])
  })
})

describe('compareDailySpend', () => {
  it('compares a month in progress with the month before at the same day, not its full total', () => {
    const result = compareDailySpend(days([20, 20]), days([10, 10, 500]))
    expect(result.currentTotal).toBe(40)
    expect(result.previousAtSameDay).toBe(20)
    expect(result.change).toBe(1)
  })

  it('a day past the end of a shorter previous month takes that month in full', () => {
    const result = compareDailySpend(days(Array(31).fill(1)), days(Array(30).fill(2)))
    expect(result.previousAtSameDay).toBe(60)
  })

  it('spending less reads as a negative change', () => {
    expect(compareDailySpend(days([25]), days([100])).change).toBe(-0.75)
  })

  it('has no change to report when the month before spent nothing by then', () => {
    expect(compareDailySpend(days([25]), days([0, 0])).change).toBeNull()
  })

  it('an empty month compares as zero, not as missing', () => {
    const result = compareDailySpend([], days([5]))
    expect(result.currentTotal).toBe(0)
    expect(result.previousAtSameDay).toBe(0)
    expect(result.change).toBeNull()
  })
})

describe('compareWithPreviousMonth', () => {
  const october = { year: 2026, month: 10 }
  const evening = new Date(2026, 9, 7, 22, 20) // Oct 7, 10:20pm

  it("keeps spending the bank has already dated tomorrow, so the total matches Home's", () => {
    const feed = [spend('1', '2026-10-06', 89.4), spend('2', '2026-10-08', 16.33)]
    const result = compareWithPreviousMonth(feed, october, evening)
    expect(result.currentTotal).toBeCloseTo(105.73)
    expect(result.current.at(-1)!.day).toBe(8)
  })

  it('compares against the month before at the same day', () => {
    const feed = [spend('1', '2026-10-02', 50), spend('2', '2026-09-03', 20), spend('3', '2026-09-20', 400)]
    const result = compareWithPreviousMonth(feed, october, evening)
    expect(result.previousAtSameDay).toBe(20)
    expect(result.previous.at(-1)).toEqual({ day: 30, total: 420 })
  })

  it('ignores refunds and income', () => {
    const feed = [spend('1', '2026-10-02', 50), spend('2', '2026-10-03', -30)]
    expect(compareWithPreviousMonth(feed, october, evening).currentTotal).toBe(50)
  })
})
