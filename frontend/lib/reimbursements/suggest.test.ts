import { describe, expect, it } from 'vitest'
import {
  parseAmountQuery,
  remainingExpense,
  scoreReimbursement,
  searchReimbursementCandidates,
  suggestReimbursements,
} from './suggest'
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
    transferRole: null,
    transferKind: null,
    transferSource: null,
    isBrokerageCashAccount: false,
    isSweptOutflow: false,
    hasCrossAccountCounterpart: false,
    links: [],
    ...overrides,
    // Defaults to the case's own `date` so proximity cases can keep saying `date` and still
    // mean it. Cases that need the display and matching dates to diverge set it explicitly.
    postedDate: overrides.postedDate ?? overrides.date,
  } as FeedItem
}

const expense = { amount: 100, date: '2026-08-01' }

describe('scoreReimbursement', () => {
  it('scores exact repayment highest', () => {
    const exact = scoreReimbursement(expense, { amount: 100, date: '2026-08-03' })!
    const half = scoreReimbursement(expense, { amount: 50, date: '2026-08-03' })!
    const odd = scoreReimbursement(expense, { amount: 37, date: '2026-08-03' })!
    expect(exact).toBeGreaterThan(half)
    expect(half).toBeGreaterThan(odd)
  })

  it('ranks a partial payback near a split anchor above an arbitrary amount', () => {
    const eighty = scoreReimbursement(expense, { amount: 80, date: '2026-08-03' })!
    const arbitrary = scoreReimbursement(expense, { amount: 41.17, date: '2026-08-03' })!
    expect(eighty).toBeGreaterThan(arbitrary)
  })

  it('rejects material overpayment but tolerates rounding slop', () => {
    expect(scoreReimbursement(expense, { amount: 120, date: '2026-08-03' })).toBeNull()
    expect(scoreReimbursement(expense, { amount: 101, date: '2026-08-03' })).not.toBeNull()
  })

  it('enforces the date window with a small grace before the expense', () => {
    expect(scoreReimbursement(expense, { amount: 50, date: '2026-07-30' })).not.toBeNull()
    expect(scoreReimbursement(expense, { amount: 50, date: '2026-07-28' })).toBeNull()
    expect(scoreReimbursement(expense, { amount: 50, date: '2026-10-29' })).not.toBeNull()
    expect(scoreReimbursement(expense, { amount: 50, date: '2026-10-31' })).toBeNull()
  })

  it('prefers sooner paybacks at equal amounts', () => {
    const soon = scoreReimbursement(expense, { amount: 50, date: '2026-08-02' })!
    const late = scoreReimbursement(expense, { amount: 50, date: '2026-09-15' })!
    expect(soon).toBeGreaterThan(late)
  })

  it('nudges P2P incomes above otherwise-identical ones', () => {
    const venmo = scoreReimbursement(expense, { amount: 50, date: '2026-08-03', merchantName: 'Venmo' })!
    const plain = scoreReimbursement(expense, { amount: 50, date: '2026-08-03', merchantName: 'Acme' })!
    expect(venmo).toBeGreaterThan(plain)
  })

  it('rejects when nothing remains to reimburse', () => {
    expect(scoreReimbursement({ amount: 0, date: '2026-08-01' }, { amount: 20, date: '2026-08-03' })).toBeNull()
  })
})

describe('suggestReimbursements', () => {
  const expenseItem = item({ id: 'dinner', amount: 100, date: '2026-08-01' })

  it('caps, orders best-first, and drops noise below the cutoff', () => {
    const candidates = [
      item({ id: 'exact', amount: -100, date: '2026-08-03' }),
      item({ id: 'half', amount: -50, date: '2026-08-03' }),
      item({ id: 'noise', amount: -3.5, date: '2026-10-25' }),
    ]
    const suggested = suggestReimbursements(expenseItem, candidates)
    expect(suggested.map((s) => s.item.id)).toEqual(['exact', 'half'])
  })

  it('re-ranks against the remaining amount as incomes get linked', () => {
    const candidates = [
      item({ id: 'sixty', amount: -60, date: '2026-08-03' }),
      item({ id: 'twenty', amount: -20, date: '2026-08-03' }),
    ]
    const before = suggestReimbursements(expenseItem, candidates)
    expect(before[0]!.item.id).toBe('sixty')

    // $60 linked → $40 remains → the $20 is now a clean half and the $60 an overpayment.
    const after = suggestReimbursements(expenseItem, [item({ id: 'twenty', amount: -20, date: '2026-08-03' })], {
      remainingOverride: 40,
    })
    expect(after.map((s) => s.item.id)).toEqual(['twenty'])
  })

  it('from the income side, scores each expense against its own un-reimbursed remainder', () => {
    const income = item({ id: 'payback', amount: -40, date: '2026-08-05' })
    const partlyReimbursed = item({ id: 'dinner', amount: 100, date: '2026-08-01', reimbursedAmount: 60 })
    const untouched = item({ id: 'groceries', amount: 300, date: '2026-08-01' })
    const suggested = suggestReimbursements(income, [untouched, partlyReimbursed])
    expect(suggested[0]!.item.id).toBe('dinner')
  })

  it('respects a custom limit', () => {
    const candidates = Array.from({ length: 12 }, (_, i) => item({ id: `c${i}`, amount: -50, date: '2026-08-03' }))
    expect(suggestReimbursements(expenseItem, candidates, { limit: 5 })).toHaveLength(5)
  })
})

describe('remainingExpense', () => {
  it('subtracts prior reimbursements and never goes negative', () => {
    expect(remainingExpense(item({ id: 'a', amount: 100, date: '2026-08-01', reimbursedAmount: 60 }))).toBe(40)
    expect(remainingExpense(item({ id: 'b', amount: 100, date: '2026-08-01', reimbursedAmount: 150 }))).toBe(0)
  })
})

describe('parseAmountQuery', () => {
  it('accepts money-shaped queries', () => {
    expect(parseAmountQuery('20')).toBe(20)
    expect(parseAmountQuery('$20.50')).toBe(20.5)
    expect(parseAmountQuery('20,50')).toBe(20.5)
  })

  it('rejects text and malformed numbers', () => {
    expect(parseAmountQuery('venmo')).toBeNull()
    expect(parseAmountQuery('20.555')).toBeNull()
    expect(parseAmountQuery('')).toBeNull()
  })
})

describe('searchReimbursementCandidates', () => {
  const pool = [
    item({ id: 'twenty', amount: -20, date: '2026-08-03', merchantName: 'Venmo' }),
    item({ id: 'twenty45', amount: -20.45, date: '2026-08-04', merchantName: 'Zelle' }),
    item({ id: 'two-o-four', amount: -204, date: '2026-08-05', merchantName: 'Payroll' }),
    item({ id: 'late', amount: -60, date: '2026-12-20', merchantName: 'Venmo' }),
  ]

  it('matches amounts by nearness and integer prefix, nearest first', () => {
    const results = searchReimbursementCandidates('20', pool)
    expect(results.map((r) => r.id)).toEqual(['twenty', 'twenty45', 'two-o-four'])
  })

  it('treats a query with cents as exact-ish, not a prefix', () => {
    expect(searchReimbursementCandidates('20.45', pool).map((r) => r.id)).toEqual(['twenty45', 'twenty'])
  })

  it('falls back to merchant search, newest first', () => {
    expect(searchReimbursementCandidates('venmo', pool).map((r) => r.id)).toEqual(['late', 'twenty'])
  })

  it('ignores the suggestion gates so out-of-window items stay reachable', () => {
    expect(searchReimbursementCandidates('60', pool).map((r) => r.id)).toEqual(['late'])
  })

  it('returns nothing for a blank query', () => {
    expect(searchReimbursementCandidates('  ', pool)).toEqual([])
  })
})
