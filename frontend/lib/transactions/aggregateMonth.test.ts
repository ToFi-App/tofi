import { describe, expect, it } from 'vitest'
import { aggregateMonth } from './aggregateMonth'
import { countsTowardTotals } from './totals'
import type { FeedItem } from './resolveFeed'

function item(overrides: Partial<FeedItem> & { id: string }): FeedItem {
  return {
    source: 'plaid',
    amount: 0,
    date: '2026-06-01',
    merchantName: 'x',
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
    ...overrides,
    // Tracks `date`: these cases care about the display/bucketing date, and letting the
    // two drift would quietly change what any proximity assertion means.
    postedDate: overrides.postedDate ?? overrides.date ?? '2026-06-01',
  }
}

describe('aggregateMonth', () => {
  it('nets categorized, uncategorized and reimbursed items into the running totals', () => {
    const result = aggregateMonth([
      item({ id: 'a', amount: 40, categoryId: 'groceries' }),
      item({ id: 'b', amount: 10 }), // uncategorized expense
      item({ id: 'c', amount: 100, reimbursedAmount: 60, netAmount: 40, categoryId: 'dining' }),
      item({ id: 'd', amount: -200, categoryId: 'salary' }),
      item({ id: 'e', amount: -25 }), // uncategorized income
    ])

    // 40 + 10 + net 40 (100 expense less 60 reimbursed)
    expect(result.totalExpense).toBe(90)
    expect(result.totalIncome).toBe(225)
    expect(result.spendByCategory.get('dining')).toBe(40)
  })

  it('counts uncategorized items in the totals but leaves them out of the per-category maps', () => {
    const result = aggregateMonth([
      item({ id: 'a', amount: 30, categoryId: 'groceries' }),
      item({ id: 'b', amount: 70 }),
      item({ id: 'c', amount: -50 }),
    ])

    expect(result.totalExpense).toBe(100)
    expect(result.totalIncome).toBe(50)
    expect(Array.from(result.spendByCategory.entries())).toEqual([['groceries', 30]])
    expect(result.incomeByCategory.size).toBe(0)
  })

  it('sums per-category totals across multiple items in the same category', () => {
    const result = aggregateMonth([
      item({ id: 'a', amount: 30, categoryId: 'groceries' }),
      item({ id: 'b', amount: 12.5, categoryId: 'groceries' }),
      item({ id: 'c', amount: -100, categoryId: 'salary' }),
      item({ id: 'd', amount: -50, categoryId: 'salary' }),
    ])

    expect(result.spendByCategory.get('groceries')).toBe(42.5)
    expect(result.incomeByCategory.get('salary')).toBe(150)
  })

  it('excludes reimbursement income from every total but still flags its day', () => {
    const result = aggregateMonth([
      item({ id: 'expense', date: '2026-06-02', amount: 80, reimbursedAmount: 30, netAmount: 50, categoryId: 'dining' }),
      item({ id: 'income', date: '2026-06-05', amount: -30, categoryId: 'dining', isReimbursementIncome: true }),
    ])

    expect(result.totalIncome).toBe(0)
    expect(result.totalExpense).toBe(50)
    expect(result.incomeByCategory.size).toBe(0)
    expect(result.spendByCategory.get('dining')).toBe(50)

    expect(result.spendByDay.get('2026-06-05')).toEqual({ net: 0, hasReimbursement: true })
    expect(result.spendByDay.get('2026-06-02')).toEqual({ net: 50, hasReimbursement: true })
  })

  it('accumulates day totals across items and leaves untouched days absent', () => {
    const result = aggregateMonth([
      item({ id: 'a', date: '2026-06-01', amount: 20 }),
      item({ id: 'b', date: '2026-06-01', amount: -5 }),
      item({ id: 'c', date: '2026-06-03', amount: 15 }),
    ])

    expect(result.spendByDay.get('2026-06-01')).toEqual({ net: 15, hasReimbursement: false })
    expect(result.spendByDay.get('2026-06-03')).toEqual({ net: 15, hasReimbursement: false })
    expect(result.spendByDay.has('2026-06-02')).toBe(false)
  })

  it('excludes both legs of a transfer from every aggregate', () => {
    const result = aggregateMonth([
      item({ id: 'a', date: '2026-06-01', amount: 40, categoryId: 'groceries' }),
      item({ id: 'out', date: '2026-06-02', amount: 500, categoryId: 'transfers-out', transferId: 't1', transferKind: 'account_transfer', transferRole: 'expense' }),
      item({ id: 'in', date: '2026-06-02', amount: -500, categoryId: 'transfers-in', transferId: 't1', transferKind: 'account_transfer', transferRole: 'income' }),
    ])

    expect(result.totalExpense).toBe(40)
    expect(result.totalIncome).toBe(0)
    expect(result.spendByCategory.has('transfers-out')).toBe(false)
    expect(result.incomeByCategory.has('transfers-in')).toBe(false)
    // Unlike a reimbursement income leg, a transfer leaves no trace on the calendar day.
    expect(result.spendByDay.has('2026-06-02')).toBe(false)
  })

  it('excludes an unpaired transfer expense, whose destination account is not connected', () => {
    const result = aggregateMonth([
      item({ id: 'a', amount: 40, categoryId: 'groceries' }),
      item({ id: 'out', amount: 500, transferId: 't1', transferKind: 'account_transfer', transferRole: 'expense' }),
    ])

    expect(result.totalExpense).toBe(40)
  })

  it('excludes a credit card payment while still counting the rest of the month', () => {
    const result = aggregateMonth([
      item({ id: 'a', amount: 40, categoryId: 'groceries' }),
      item({ id: 'pay', amount: 1200, transferId: 't2', transferKind: 'credit_card_payment', transferRole: 'expense' }),
      item({ id: 'post', amount: -1200, transferId: 't2', transferKind: 'credit_card_payment', transferRole: 'income' }),
      item({ id: 'salary', amount: -3000, categoryId: 'salary' }),
    ])

    expect(result.totalExpense).toBe(40)
    expect(result.totalIncome).toBe(3000)
  })

  // The sweep's counterpart is an investment transaction, outside /transactions/sync, so it
  // never pairs into a transfer record — it has to be excluded on its PFC alone.
  it('excludes a cash-management sweep that has no transfer record', () => {
    const result = aggregateMonth([
      item({ id: 'a', date: '2026-06-01', amount: 40, categoryId: 'groceries' }),
      item({ id: 'sweep', date: '2026-06-02', amount: 500, categoryId: 'transfers-out', pfcDetailed: 'TRANSFER_OUT_INVESTMENT_AND_RETIREMENT_FUNDS', isBrokerageCashAccount: true }),
    ])

    expect(result.totalExpense).toBe(40)
    expect(result.spendByCategory.has('transfers-out')).toBe(false)
    expect(result.spendByDay.has('2026-06-02')).toBe(false)
  })

  // The amount-mirror rule in applySweepExclusion catches the sweeps the PFC rule can't: the code
  // on these is a generic TRANSFER_OUT_ACCOUNT_TRANSFER, so isInternalMovement is false and
  // isSweptOutflow is the only signal. The row already renders greyed out via countsTowardTotals,
  // and the aggregates have to agree with it.
  it('excludes a sweep caught only by the amount-mirror rule, not its PFC', () => {
    const result = aggregateMonth([
      item({ id: 'a', date: '2026-06-01', amount: 40, categoryId: 'groceries' }),
      item({
        id: 'sweep',
        date: '2026-06-02',
        amount: 286,
        categoryId: 'transfers-out',
        pfcDetailed: 'TRANSFER_OUT_ACCOUNT_TRANSFER',
        isBrokerageCashAccount: true,
        isSweptOutflow: true,
        hasCrossAccountCounterpart: false,
      }),
    ])

    expect(result.totalExpense).toBe(40)
    expect(result.spendByCategory.has('transfers-out')).toBe(false)
    expect(result.spendByDay.has('2026-06-02')).toBe(false)
  })

  it('keeps counting a credit card payment that never paired, since the card is not linked', () => {
    const result = aggregateMonth([
      item({ id: 'pay', amount: 1200, categoryId: 'payments', pfcDetailed: 'LOAN_PAYMENTS_CREDIT_CARD_PAYMENT' }),
    ])

    expect(result.totalExpense).toBe(1200)
  })

  it('returns empty aggregates for an empty feed', () => {
    const result = aggregateMonth([])
    expect(result.totalExpense).toBe(0)
    expect(result.totalIncome).toBe(0)
    expect(result.spendByCategory.size).toBe(0)
    expect(result.incomeByCategory.size).toBe(0)
    expect(result.spendByDay.size).toBe(0)
  })
})

describe('aggregateMonth: investment-source rows', () => {
  const investment = (overrides: Partial<FeedItem> & { id: string }): FeedItem =>
    item({
      source: 'investment',
      accountId: 'acc-ira',
      isBrokerageCashAccount: true,
      ...overrides,
    })


  it('still counts an unpaired contribution and withdrawal', () => {
    const result = aggregateMonth([
      investment({ id: 'contrib', amount: -500, date: '2026-06-05' }),
      investment({ id: 'wd', amount: 300, date: '2026-06-06' }),
    ])

    expect(result.totalIncome).toBe(500)
    expect(result.totalExpense).toBe(300)
  })

  it('agrees with countsTowardTotals row by row', () => {
    // Pins the delegation itself: any future exclusion added to the predicate lands here for free.
    const feed = [
      investment({ id: 'withdrawal', amount: 400 }),
      investment({ id: 'contrib', amount: -400 }),
      item({ id: 'groceries', amount: 60 }),
      item({ id: 'swept', amount: 80, isBrokerageCashAccount: true, isSweptOutflow: true }),
    ]
    const expected = feed.filter(countsTowardTotals)
    const expense = expected.filter((i) => i.amount > 0).reduce((s, i) => s + i.amount, 0)
    const income = expected.filter((i) => i.amount < 0).reduce((s, i) => s + Math.abs(i.amount), 0)

    const result = aggregateMonth(feed)
    expect(result.totalExpense).toBe(expense)
    expect(result.totalIncome).toBe(income)
  })
})
