import { describe, expect, it } from 'vitest'
import { buildTransferInputs } from './buildTransferInputs'
import type { FeedItem } from '@/lib/transactions/resolveFeed'

function item(overrides: Partial<FeedItem> & Pick<FeedItem, 'id' | 'amount' | 'date'>): FeedItem {
  return {
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

const expense = item({ id: 'e1', amount: 500, date: '2026-08-10' })
const income = item({ id: 'i1', amount: -500, date: '2026-08-11', accountId: 'savings' })
const feed = [expense, income]

describe('buildTransferInputs', () => {
  it('puts the positive-amount item on the expense leg and the counterpart on the income leg', () => {
    expect(buildTransferInputs(expense, { kind: 'account_transfer', counterpartIds: ['i1'] }, feed)).toEqual([
      {
        kind: 'account_transfer',
        expensePlaidTransactionId: 'e1',
        expenseManualTransactionId: null,
        incomePlaidTransactionId: 'i1',
        incomeManualTransactionId: null,
        amount: '500.00',
        note: null,
      },
    ])
  })

  it('keeps the legs straight when the marked item is the income side', () => {
    const [input] = buildTransferInputs(income, { kind: 'account_transfer', counterpartIds: ['e1'] }, feed)
    expect(input.expensePlaidTransactionId).toBe('e1')
    expect(input.incomePlaidTransactionId).toBe('i1')
  })

  it('routes manual transactions to the manual id fields', () => {
    const manual = item({ id: 'm1', amount: 40, date: '2026-08-10', source: 'manual' })
    const [input] = buildTransferInputs(manual, { kind: 'account_transfer', counterpartIds: [] }, [manual])
    expect(input.expenseManualTransactionId).toBe('m1')
    expect(input.expensePlaidTransactionId).toBeNull()
  })

  it('creates a one-legged transfer when no counterpart was picked', () => {
    const inputs = buildTransferInputs(expense, { kind: 'account_transfer', counterpartIds: [] }, feed)
    expect(inputs).toHaveLength(1)
    expect(inputs[0].incomePlaidTransactionId).toBeNull()
    expect(inputs[0].amount).toBe('500.00')
  })

  // A reimbursement records what came back, never what was spent: the income leg's amount. The
  // flow is entered from the income side (registry's appliesTo), so the marked item is the income
  // and the counterpart is the expense — the opposite of every other kind, where the marked item
  // carries the amount.
  it('records the income amount for a reimbursement marked from the income side', () => {
    const reimbursedExpense = item({ id: 'e2', amount: 2055.32, date: '2026-08-12' })
    const reimbursementIncome = item({ id: 'i2', amount: -2000, date: '2026-08-13', accountId: 'savings' })
    const [input] = buildTransferInputs(
      reimbursementIncome,
      { kind: 'reimbursement', counterpartIds: ['e2'] },
      [reimbursedExpense, reimbursementIncome],
    )
    expect(input.expensePlaidTransactionId).toBe('e2')
    expect(input.incomePlaidTransactionId).toBe('i2')
    expect(input.amount).toBe('2000.00')
  })

  it('records the counterpart amount for a reimbursement marked from the expense side', () => {
    const partial = item({ id: 'i2', amount: -120, date: '2026-08-12' })
    const [input] = buildTransferInputs(expense, { kind: 'reimbursement', counterpartIds: ['i2'] }, [expense, partial])
    expect(input.amount).toBe('120.00')
  })

  it('falls back to the marked item amount for a reimbursement with no counterpart', () => {
    const [input] = buildTransferInputs(expense, { kind: 'reimbursement', counterpartIds: [] }, feed)
    expect(input.amount).toBe('500.00')
  })

  it('skips counterpart ids that are no longer in the feed', () => {
    const [input] = buildTransferInputs(expense, { kind: 'account_transfer', counterpartIds: ['gone'] }, feed)
    expect(input.incomePlaidTransactionId).toBeNull()
    expect(input.incomeManualTransactionId).toBeNull()
  })

  // Investment legs share the plaid id columns; matching only source === 'plaid' left them null
  // on all four, persisting a one-legged transfer whose investment side was never stamped —
  // the checking outflow dropped out of totals while the investment inflow stayed counted as
  // income that never existed.
  it('routes an investment leg to the plaid id columns', () => {
    const contribution = item({
      id: 'itx-1',
      amount: -1000,
      date: '2026-08-10',
      source: 'investment',
      accountId: 'acc-ira',
    })
    const outflow = item({ id: 'txn-out', amount: 1000, date: '2026-08-10' })
    const [input] = buildTransferInputs(
      outflow,
      { kind: 'account_transfer', counterpartIds: ['itx-1'] },
      [outflow, contribution],
    )

    expect(input.expensePlaidTransactionId).toBe('txn-out')
    expect(input.incomePlaidTransactionId).toBe('itx-1')
    expect(input.incomeManualTransactionId).toBeNull()
  })

  it('stamps an investment leg marked from the investment side too', () => {
    const withdrawal = item({
      id: 'itx-2',
      amount: 800,
      date: '2026-08-10',
      source: 'investment',
      accountId: 'acc-ira',
    })
    const [input] = buildTransferInputs(withdrawal, { kind: 'account_transfer', counterpartIds: [] }, [withdrawal])

    expect(input.expensePlaidTransactionId).toBe('itx-2')
    expect(input.expenseManualTransactionId).toBeNull()
  })
})
