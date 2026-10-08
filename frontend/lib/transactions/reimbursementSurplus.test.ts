import { describe, expect, it } from 'vitest'
import { applyTransfers, mergeFeed } from './resolveFeed'
import { aggregateMonth } from './aggregateMonth'
import { dayTotals } from './dayTotals'
import { countsTowardTotals } from './totals'
import { linkPillLabel } from './linkSummary'
import type { PlaidTransaction, Transfer } from '@/types/domain'

// An income bigger than the expense it's linked to as a reimbursement: the expense nets to zero,
// and what's left of the income is still income. It used to vanish with the reimbursed part.
describe('a reimbursement larger than its expense', () => {
  const plaidTxns = [
    { transaction_id: 'trip', account_id: 'visa', amount: 2000, date: '2026-08-05', name: 'HOTEL', merchant_name: 'Hotel', pending: false },
    { transaction_id: 'payout', account_id: 'checking', amount: -5000, date: '2026-08-12', name: 'PAYROLL', merchant_name: 'Employer', pending: false },
  ] as unknown as PlaidTransaction[]
  const feed = mergeFeed(plaidTxns, [], [], [])
  // As the link sheet records it: the whole income, whichever side the user started from.
  const link: Transfer = {
    id: 'r1', kind: 'reimbursement', source: 'manual',
    expensePlaidTransactionId: 'trip', expenseManualTransactionId: null,
    incomePlaidTransactionId: 'payout', incomeManualTransactionId: null,
    amount: '5000.00', note: null,
  }
  const linked = applyTransfers(feed, [link])
  const find = (id: string) => linked.find((item) => item.id === id)!

  it('nets the expense to zero, reimbursed only by what it cost', () => {
    expect(find('trip')).toMatchObject({ reimbursedAmount: 2000, netAmount: 0 })
    expect(find('trip').links[0].amount).toBe(2000)
  })

  it('keeps the rest of the income as income', () => {
    expect(find('payout')).toMatchObject({ isReimbursementIncome: true, netAmount: -3000 })
    expect(find('payout').links[0].amount).toBe(2000)
    expect(countsTowardTotals(find('payout'))).toBe(true)
  })

  it('counts $3,000 of income and no spending in the month', () => {
    const { totalExpense, totalIncome } = aggregateMonth(linked)
    expect(totalExpense).toBe(0)
    expect(totalIncome).toBe(3000)
  })

  it('says on each row how much went to the expense', () => {
    expect(linkPillLabel(find('trip'))).toBe('Reimbursed: $2,000.00')
    expect(linkPillLabel(find('payout'))).toBe('$2,000.00 reimbursed')
  })

  it("shows the surplus in the income day's header", () => {
    expect(dayTotals([find('payout')])).toEqual({ income: 3000, expense: 0 })
  })

  it('still counts nothing for an income that only covers its expense', () => {
    const exact = applyTransfers(mergeFeed([plaidTxns[0], { ...plaidTxns[1], amount: -2000 }], [], [], []), [{ ...link, amount: '2000.00' }])
    const income = exact.find((item) => item.id === 'payout')!
    expect(income.netAmount).toBe(0)
    expect(countsTowardTotals(income)).toBe(false)
    expect(aggregateMonth(exact)).toMatchObject({ totalExpense: 0, totalIncome: 0 })
  })
})

describe('several reimbursements against one expense', () => {
  // A $100 dinner paid back $80 first and $50 later: the earlier one is used in full, the later
  // one only for the $20 still owed, and its other $30 is income.
  const plaidTxns = [
    { transaction_id: 'dinner', account_id: 'visa', amount: 100, date: '2026-08-01', name: 'DINNER', merchant_name: 'Bistro', pending: false },
    { transaction_id: 'alice', account_id: 'checking', amount: -50, date: '2026-08-09', name: 'VENMO', merchant_name: 'Alice', pending: false },
    { transaction_id: 'bob', account_id: 'checking', amount: -80, date: '2026-08-03', name: 'VENMO', merchant_name: 'Bob', pending: false },
  ] as unknown as PlaidTransaction[]
  const transfers: Transfer[] = [
    { id: 'r-alice', kind: 'reimbursement', source: 'manual', expensePlaidTransactionId: 'dinner', expenseManualTransactionId: null, incomePlaidTransactionId: 'alice', incomeManualTransactionId: null, amount: '50.00', note: null },
    { id: 'r-bob', kind: 'reimbursement', source: 'manual', expensePlaidTransactionId: 'dinner', expenseManualTransactionId: null, incomePlaidTransactionId: 'bob', incomeManualTransactionId: null, amount: '80.00', note: null },
  ]
  const linked = applyTransfers(mergeFeed(plaidTxns, [], [], []), transfers)
  const find = (id: string) => linked.find((item) => item.id === id)!

  it('fills the expense in the order the money came back', () => {
    expect(find('dinner')).toMatchObject({ reimbursedAmount: 100, netAmount: 0 })
    expect(find('bob').netAmount).toBe(0)
    expect(find('alice').netAmount).toBe(-30)
    expect(aggregateMonth(linked)).toMatchObject({ totalExpense: 0, totalIncome: 30 })
  })
})
