import { describe, expect, it } from 'vitest'
import { linkPillLabel } from './linkSummary'
import type { FeedItem, FeedLink } from './resolveFeed'

function item(overrides: Partial<FeedItem> & Pick<FeedItem, 'id' | 'amount'>): FeedItem {
  return {
    source: 'plaid',
    date: '2026-08-12',
    merchantName: 'United Airlines',
    categoryId: null,
    subcategoryId: null,
    categorySource: 'uncategorized',
    confidenceLevel: null,
    pfcDetailed: null,
    accountId: 'visa',
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

function link(overrides: Partial<FeedLink> = {}): FeedLink {
  return {
    recordId: 'r1',
    kind: 'reimbursement',
    itemId: 'payout',
    merchantName: 'Expensify',
    date: '2026-08-13',
    accountId: 'checking',
    amount: 2000,
    ...overrides,
  }
}

describe('linkPillLabel', () => {
  it('shows what came back', () => {
    const expense = item({ id: 'flight', amount: 2055.32, reimbursedAmount: 2000, netAmount: 55.32 })
    expect(linkPillLabel(expense)).toBe('Reimbursed: $2,000.00')
  })

  it('sums several reimbursements into one pill, since the sheet itemizes them', () => {
    const expense = item({
      id: 'flight',
      amount: 2055.32,
      reimbursedAmount: 2055.32,
      netAmount: 0,
      links: [link({ amount: 2000 }), link({ recordId: 'r2', amount: 55.32 })],
    })
    expect(linkPillLabel(expense)).toBe('Reimbursed: $2,055.32')
  })

  it('names the expense a reimbursement income paid back', () => {
    const income = item({ id: 'payout', amount: -2000, isReimbursementIncome: true, links: [link({ itemId: 'flight', merchantName: 'United Airlines' })] })
    expect(linkPillLabel(income)).toBe('Reimbursed: United Airlines')
  })

  it('falls back to a bare label when the expense it paid back is outside the feed', () => {
    const income = item({ id: 'payout', amount: -2000, isReimbursementIncome: true, links: [link({ itemId: null, merchantName: null })] })
    expect(linkPillLabel(income)).toBe('Reimbursed')
  })

  it('leaves non-reimbursement rows to the transfer badge', () => {
    expect(linkPillLabel(item({ id: 'lunch', amount: 12 }))).toBeNull()
    expect(linkPillLabel(item({ id: 'out', amount: 500, transferKind: 'account_transfer', links: [link({ kind: 'account_transfer' })] }))).toBeNull()
  })
})
