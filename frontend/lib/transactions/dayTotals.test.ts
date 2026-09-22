import { describe, expect, it } from 'vitest'
import { dayTotals } from './dayTotals'
import type { FeedItem } from './resolveFeed'

function item(overrides: Partial<FeedItem> & { id: string }): FeedItem {
  return {
    source: 'plaid',
    amount: 0,
    date: '2026-07-10',
    merchantName: 'x',
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
    postedDate: overrides.postedDate ?? overrides.date ?? '2026-07-10',
  }
}

describe('dayTotals', () => {
  it('splits a day into income and expense', () => {
    expect(dayTotals([item({ id: 'a', amount: 15.15 }), item({ id: 'b', amount: -40 })])).toEqual({
      income: 40,
      expense: 15.15,
    })
  })

  it('nets a reimbursed expense down to what the user actually paid', () => {
    expect(dayTotals([item({ id: 'a', amount: 100, reimbursedAmount: 60, netAmount: 40 })])).toEqual({
      income: 0,
      expense: 40,
    })
  })

  // The whole point of the split: a day of nothing but excluded rows reads as zero, which is what
  // lets the header render muted rather than claiming spend the greyed rows below it don't have.
  it('returns zero for a day whose only row is an excluded sweep', () => {
    expect(
      dayTotals([item({ id: 'sweep', amount: 286, isBrokerageCashAccount: true, isSweptOutflow: true })]),
    ).toEqual({ income: 0, expense: 0 })
  })

  it('leaves out a transfer leg and a reimbursement income leg', () => {
    expect(
      dayTotals([
        item({ id: 'out', amount: 500, transferId: 't1', transferKind: 'account_transfer', transferRole: 'expense' }),
        item({ id: 'reimb', amount: -60, isReimbursementIncome: true }),
        item({ id: 'real', amount: 12 }),
      ]),
    ).toEqual({ income: 0, expense: 12 })
  })

  it('returns zero for no rows', () => {
    expect(dayTotals([])).toEqual({ income: 0, expense: 0 })
  })
})
