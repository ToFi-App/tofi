import { describe, expect, it } from 'vitest'
import { TRANSFER_TYPES, daysBetween } from './registry'
import type { TransferContext } from './registry'
import type { FeedItem } from '@/lib/transactions/resolveFeed'
import type { Account, TransferKind } from '@/types/domain'

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
    // Defaults to the case's own `date` so proximity cases can keep saying `date` and still
    // mean it. Cases that need the display and matching dates to diverge set it explicitly.
    postedDate: overrides.postedDate ?? overrides.date,
  }
}

const accounts = [
  { account_id: 'checking', type: 'depository' },
  { account_id: 'savings', type: 'depository' },
  { account_id: 'visa', type: 'credit' },
] as unknown as Account[]

const ctx: TransferContext = { accounts }

const expense = item({ id: 'e1', amount: 500, date: '2026-08-10', accountId: 'checking' })
const incomeOnSavings = item({ id: 'i1', amount: -500, date: '2026-08-10', accountId: 'savings' })

function income(overrides: Partial<FeedItem>): FeedItem {
  return item({ id: 'i1', amount: -500, date: '2026-08-10', accountId: 'savings', ...overrides })
}

describe('daysBetween', () => {
  it('counts whole calendar days regardless of direction', () => {
    expect(daysBetween('2026-08-10', '2026-08-17')).toBe(7)
    expect(daysBetween('2026-08-17', '2026-08-10')).toBe(7)
  })

  it('is unaffected by a DST boundary', () => {
    expect(daysBetween('2026-03-07', '2026-03-09')).toBe(2)
  })
})

describe('account_transfer', () => {
  const { matches, appliesTo } = TRANSFER_TYPES.account_transfer

  it('applies to any item', () => {
    expect(appliesTo(expense, ctx)).toBe(true)
    expect(appliesTo(incomeOnSavings, ctx)).toBe(true)
  })

  describe('starting from expense', () => {
    it('accepts an exact-amount income leg on the same day', () => {
      expect(matches(expense, income({}), ctx)).toBe(true)
    })

    it('accepts an amount within 5% tolerance', () => {
      expect(matches(expense, income({ amount: -475 }), ctx)).toBe(true)
      expect(matches(expense, income({ amount: -525 }), ctx)).toBe(true)
    })

    it('rejects an amount outside 5% tolerance', () => {
      expect(matches(expense, income({ amount: -474.99 }), ctx)).toBe(false)
      expect(matches(expense, income({ amount: -525.01 }), ctx)).toBe(false)
    })

    it('accepts a date exactly 7 days away', () => {
      expect(matches(expense, income({ date: '2026-08-17' }), ctx)).toBe(true)
      expect(matches(expense, income({ date: '2026-08-03' }), ctx)).toBe(true)
    })

    it('rejects a date 8 days away', () => {
      expect(matches(expense, income({ date: '2026-08-18' }), ctx)).toBe(false)
    })

    it('rejects same account', () => {
      expect(matches(expense, income({ accountId: 'checking' }), ctx)).toBe(false)
    })

    it('accepts a manual candidate (null account)', () => {
      expect(matches(expense, income({ accountId: null, source: 'manual' }), ctx)).toBe(true)
    })

    it('rejects same-sign candidate', () => {
      expect(matches(expense, income({ amount: 500 }), ctx)).toBe(false)
    })

    it('rejects the expense itself', () => {
      expect(matches(expense, { ...expense, amount: -500 }, ctx)).toBe(false)
    })
  })

  describe('starting from income (bidirectional)', () => {
    const startIncome = item({ id: 'i2', amount: -500, date: '2026-08-10', accountId: 'savings' })
    const matchingExpense = item({ id: 'e2', amount: 500, date: '2026-08-10', accountId: 'checking' })

    it('accepts a matching expense from the income side', () => {
      expect(matches(startIncome, matchingExpense, ctx)).toBe(true)
    })

    it('rejects same-sign candidate from income side', () => {
      expect(matches(startIncome, item({ id: 'i3', amount: -500, date: '2026-08-10', accountId: 'checking' }), ctx)).toBe(false)
    })
  })
})

describe('credit_card_payment', () => {
  const { matches, appliesTo } = TRANSFER_TYPES.credit_card_payment

  describe('appliesTo', () => {
    it('applies to any expense', () => {
      expect(appliesTo(expense, ctx)).toBe(true)
    })

    it('applies to income on a liability account', () => {
      const ccIncome = item({ id: 'cc1', amount: -500, date: '2026-08-10', accountId: 'visa' })
      expect(appliesTo(ccIncome, ctx)).toBe(true)
    })

    it('does not apply to income on a depository account', () => {
      expect(appliesTo(incomeOnSavings, ctx)).toBe(false)
    })
  })

  describe('starting from expense', () => {
    it('accepts income on a credit account with exact amount', () => {
      expect(matches(expense, income({ accountId: 'visa' }), ctx)).toBe(true)
    })

    it('rejects income on a depository account', () => {
      expect(matches(expense, income({ accountId: 'savings' }), ctx)).toBe(false)
    })

    it('rejects inexact amount', () => {
      expect(matches(expense, income({ accountId: 'visa', amount: -600 }), ctx)).toBe(false)
    })

    it('rejects outside 7-day window', () => {
      expect(matches(expense, income({ accountId: 'visa', date: '2026-08-20' }), ctx)).toBe(false)
    })

    it('rejects a manual candidate (no account)', () => {
      expect(matches(expense, income({ accountId: null, source: 'manual' }), ctx)).toBe(false)
    })
  })

  describe('starting from income on CC (bidirectional)', () => {
    const ccIncome = item({ id: 'cc1', amount: -500, date: '2026-08-10', accountId: 'visa' })
    const matchingExpense = item({ id: 'e2', amount: 500, date: '2026-08-10', accountId: 'checking' })

    it('accepts any expense as counterpart', () => {
      expect(matches(ccIncome, matchingExpense, ctx)).toBe(true)
    })

    it('rejects same-sign candidate', () => {
      expect(matches(ccIncome, item({ id: 'e3', amount: -500, date: '2026-08-10', accountId: 'checking' }), ctx)).toBe(false)
    })
  })
})

describe('refund', () => {
  const { matches, appliesTo } = TRANSFER_TYPES.refund

  it('applies to any item', () => {
    expect(appliesTo(expense, ctx)).toBe(true)
    expect(appliesTo(incomeOnSavings, ctx)).toBe(true)
  })

  it('accepts exact amount within 30-day window', () => {
    expect(matches(expense, income({ date: '2026-09-09' }), ctx)).toBe(true)
  })

  it('rejects outside 30-day window', () => {
    expect(matches(expense, income({ date: '2026-09-10' }), ctx)).toBe(false)
  })

  it('rejects inexact amount', () => {
    expect(matches(expense, income({ amount: -499.99 }), ctx)).toBe(false)
  })

  it('does not require different account', () => {
    expect(matches(expense, income({ accountId: 'checking' }), ctx)).toBe(true)
  })

  it('rejects same-sign candidate', () => {
    expect(matches(expense, income({ amount: 500 }), ctx)).toBe(false)
  })

  it('works bidirectionally — income matching expense', () => {
    const refundIncome = item({ id: 'r1', amount: -200, date: '2026-08-10', accountId: 'checking' })
    const originalExpense = item({ id: 'r2', amount: 200, date: '2026-08-01', accountId: 'checking' })
    expect(matches(refundIncome, originalExpense, ctx)).toBe(true)
  })
})

describe('reimbursement', () => {
  const { matches, appliesTo } = TRANSFER_TYPES.reimbursement

  it('applies only to income', () => {
    expect(appliesTo(incomeOnSavings, ctx)).toBe(true)
    expect(appliesTo(expense, ctx)).toBe(false)
  })

  it('accepts any opposite-sign candidate (expense)', () => {
    expect(matches(incomeOnSavings, item({ id: 'e2', amount: 500, date: '2026-08-10', accountId: 'checking' }), ctx)).toBe(true)
  })

  it('accepts different amounts (partial reimbursement)', () => {
    expect(matches(incomeOnSavings, item({ id: 'e2', amount: 100, date: '2026-08-10', accountId: 'checking' }), ctx)).toBe(true)
  })

  it('rejects same-sign candidate', () => {
    expect(matches(incomeOnSavings, income({ id: 'i2' }), ctx)).toBe(false)
  })

  it('does not allow unpaired', () => {
    expect(TRANSFER_TYPES.reimbursement.allowsUnpaired).toBe(false)
  })

  // One reimbursement income pays back exactly one expense. Linking several expenses to a single
  // income has no defined split, and every row would record the full income amount.
  it('is single-select', () => {
    expect(TRANSFER_TYPES.reimbursement.multiSelect).toBeFalsy()
  })
})

describe('TRANSFER_TYPES', () => {
  it('defines every field of the interface for each kind, keyed by its own kind', () => {
    for (const [key, definition] of Object.entries(TRANSFER_TYPES)) {
      expect(definition.kind).toBe(key as TransferKind)
      expect(definition.label.length).toBeGreaterThan(0)
      expect(definition.icon.length).toBeGreaterThan(0)
      expect(definition.color).toMatch(/^#[0-9A-Fa-f]{6}$/)
      expect(typeof definition.appliesTo).toBe('function')
      expect(typeof definition.matches).toBe('function')
      expect(typeof definition.allowsUnpaired).toBe('boolean')
    }
  })
})
