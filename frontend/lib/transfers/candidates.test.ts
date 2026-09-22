import { describe, expect, it } from 'vitest'
import { transferCandidates } from './candidates'
import type { FeedItem } from '@/lib/transactions/resolveFeed'

function item(overrides: Partial<FeedItem> & Pick<FeedItem, 'id' | 'amount'>): FeedItem {
  return {
    source: 'plaid',
    date: '2026-08-12',
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
    postedDate: overrides.postedDate ?? overrides.date ?? '2026-08-12',
  }
}

const income = item({ id: 'payout', amount: -2000 })
const expense = item({ id: 'flight', amount: 2055.32 })

describe('transferCandidates', () => {
  it('offers only the opposite sign', () => {
    const otherIncome = item({ id: 'salary', amount: -5000 })
    expect(transferCandidates([expense, otherIncome], income).map((c) => c.id)).toEqual(['flight'])
  })

  it('excludes an item already committed to a transfer', () => {
    const taken = item({ id: 'taken', amount: 300, transferKind: 'account_transfer', transferId: 't1' })
    expect(transferCandidates([expense, taken], income).map((c) => c.id)).toEqual(['flight'])
  })

  // One income pays back one expense. Once it has been spent reimbursing something, offering it
  // again would split it across two expenses and over-credit both.
  it('excludes an income already spent on a reimbursement', () => {
    const spent = item({ id: 'spent', amount: -500, isReimbursementIncome: true })
    expect(transferCandidates([spent, income], expense).map((c) => c.id)).toEqual(['payout'])
  })

  // The reverse is allowed: an expense can be paid back by several separate incomes.
  it('still offers an expense that is already partly reimbursed', () => {
    const partly = item({ id: 'partly', amount: 800, reimbursedAmount: 300, netAmount: 500 })
    expect(transferCandidates([partly], income).map((c) => c.id)).toEqual(['partly'])
  })

  it('never offers the item itself', () => {
    expect(transferCandidates([income], income)).toEqual([])
  })
})
