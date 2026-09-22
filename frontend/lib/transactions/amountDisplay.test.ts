import { describe, expect, it } from 'vitest'
import { colors } from '@/constants/theme'
import { amountSign, transactionAmountColor } from './amountDisplay'
import type { FeedItem } from './resolveFeed'

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

describe('transactionAmountColor', () => {
  it('writes spending in the expense colour and money in as income', () => {
    expect(transactionAmountColor(item({ id: 'a', amount: 12 }))).toBe(colors.expense)
    expect(transactionAmountColor(item({ id: 'b', amount: -12 }))).toBe(colors.income)
  })

  it('greys anything the totals leave out', () => {
    expect(transactionAmountColor(item({ id: 'c', amount: 500, transferKind: 'account_transfer' }))).toBe(colors.textMuted)
    expect(transactionAmountColor(item({ id: 'd', amount: 500, isSweptOutflow: true }))).toBe(colors.textMuted)
  })

  it('gives a reimbursement income the reimbursed colour, not grey and not income green', () => {
    expect(transactionAmountColor(item({ id: 'e', amount: -2000, isReimbursementIncome: true }))).toBe(colors.reimbursed)
  })

  it('leaves a partly reimbursed expense reading as spending — it still costs something', () => {
    expect(transactionAmountColor(item({ id: 'f', amount: 2055.32, reimbursedAmount: 2000, netAmount: 55.32 }))).toBe(colors.expense)
  })
})

describe('amountSign', () => {
  it('follows the feed convention that positive is money out', () => {
    expect(amountSign(item({ id: 'a', amount: 12 }))).toBe('-')
    expect(amountSign(item({ id: 'b', amount: -12 }))).toBe('+')
  })
})
