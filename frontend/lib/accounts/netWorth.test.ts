import { describe, expect, it } from 'vitest'
import { computeCashOnHand, computeNetWorthTotals, isLiabilityAccount } from './netWorth'
import type { FeedItem } from '@/lib/transactions/resolveFeed'
import type { Account } from '@/types/domain'

function manual(amount: number, id = `m-${amount}`): FeedItem {
  return {
    id,
    source: 'manual',
    amount, // Plaid convention: positive = money out
    date: '2026-07-01',
    postedDate: '2026-07-01',
    merchantName: 'Cash',
    categoryId: null,
    subcategoryId: null,
    categorySource: 'uncategorized',
    confidenceLevel: null,
    pfcDetailed: null,
    accountId: null,
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
  }
}

function plaidTxn(amount: number): FeedItem {
  return { ...manual(amount, `p-${amount}`), source: 'plaid', accountId: 'checking' }
}

function account(type: string, current: number, id = type): Account {
  return { account_id: id, type, balances: { current } } as unknown as Account
}

describe('computeCashOnHand', () => {
  it('adds cash income and subtracts cash expenses', () => {
    expect(computeCashOnHand([manual(-1000.84), manual(300)])).toBe(700.84)
  })

  it('ignores Plaid transactions, which are already in the account balance', () => {
    expect(computeCashOnHand([plaidTxn(500), plaidTxn(-200)])).toBe(0)
  })

  it('goes negative when more cash was spent than was ever logged as received', () => {
    // Meaningful, not a bug: the wallet started with money the app was never told about.
    expect(computeCashOnHand([manual(50)])).toBe(-50)
  })

  it('is zero, never -0, for an empty feed', () => {
    expect(Object.is(computeCashOnHand([]), 0)).toBe(true)
  })
})

describe('computeNetWorthTotals', () => {
  it('folds cash on hand into total assets', () => {
    const totals = computeNetWorthTotals([account('depository', 110)], [manual(-1000.84)])

    expect(totals).toEqual({
      totalAssets: 1110.84,
      totalLiabilities: 0,
      cashOnHand: 1000.84,
      netWorth: 1110.84,
    })
  })

  it('subtracts credit and loan balances as liabilities', () => {
    const accounts = [account('depository', 1000), account('credit', 250.37), account('loan', 500)]
    const totals = computeNetWorthTotals(accounts, [])

    expect(totals.totalLiabilities).toBe(750.37)
    expect(totals.netWorth).toBe(249.63)
  })

  it('counts investment and brokerage balances as assets', () => {
    const totals = computeNetWorthTotals([account('investment', 5000), account('brokerage', 2500)], [])
    expect(totals.totalAssets).toBe(7500)
  })

  it('treats a missing balance as zero rather than NaN', () => {
    const totals = computeNetWorthTotals([{ account_id: 'x', type: 'depository' } as unknown as Account], [])
    expect(totals.netWorth).toBe(0)
  })

  it('keeps cash spending out of the liability column', () => {
    // Spending cash reduces assets; it does not create debt.
    const totals = computeNetWorthTotals([account('depository', 100)], [manual(40)])
    expect(totals.totalLiabilities).toBe(0)
    expect(totals.totalAssets).toBe(60)
  })
})

describe('isLiabilityAccount', () => {
  it('covers credit and loans but not depository or investment', () => {
    expect(isLiabilityAccount({ type: 'credit' })).toBe(true)
    expect(isLiabilityAccount({ type: 'loan' })).toBe(true)
    expect(isLiabilityAccount({ type: 'depository' })).toBe(false)
    expect(isLiabilityAccount({ type: 'investment' })).toBe(false)
  })
})
