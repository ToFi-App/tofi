import { describe, expect, it } from 'vitest'
import { UNCATEGORIZED_ID, computeDonutSegments } from './visualizationData'
import type { FeedItem } from './resolveFeed'

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

const categories = [
  { id: 'food', name: 'Food', icon: '🍜', color: '#F00' },
  { id: 'rent', name: 'Rent', icon: '🏠', color: '#0F0' },
]

describe('computeDonutSegments', () => {
  // The donut draws each segment as its percentage of the ring. Anything left out of the
  // segment list shows up as a gap in what should be a closed circle.
  it('covers the whole total when some spend is uncategorized', () => {
    const feed = [
      item({ id: 'a', amount: 60, date: '2026-08-01', categoryId: 'food' }),
      item({ id: 'b', amount: 40, date: '2026-08-02' }),
    ]
    const segments = computeDonutSegments(feed, new Map([['food', 60]]), categories, 100, 'expense')

    expect(segments.reduce((sum, s) => sum + s.percentage, 0)).toBeCloseTo(100)
    expect(segments.find((s) => s.categoryId === UNCATEGORIZED_ID)?.amount).toBe(40)
  })

  it('covers the whole total when every transaction is categorized', () => {
    const feed = [
      item({ id: 'a', amount: 60, date: '2026-08-01', categoryId: 'food' }),
      item({ id: 'b', amount: 40, date: '2026-08-02', categoryId: 'rent' }),
    ]
    const segments = computeDonutSegments(
      feed,
      new Map([['food', 60], ['rent', 40]]),
      categories,
      100,
      'expense',
    )

    expect(segments.reduce((sum, s) => sum + s.percentage, 0)).toBeCloseTo(100)
    expect(segments.some((s) => s.categoryId === UNCATEGORIZED_ID)).toBe(false)
  })

  it('counts the transactions behind each segment', () => {
    const feed = [
      item({ id: 'a', amount: 30, date: '2026-08-01', categoryId: 'food' }),
      item({ id: 'b', amount: 30, date: '2026-08-02', categoryId: 'food' }),
      item({ id: 'c', amount: 40, date: '2026-08-03' }),
    ]
    const segments = computeDonutSegments(feed, new Map([['food', 60]]), categories, 100, 'expense')

    expect(segments.find((s) => s.categoryId === 'food')?.transactionCount).toBe(2)
    expect(segments.find((s) => s.categoryId === UNCATEGORIZED_ID)?.transactionCount).toBe(1)
  })

  it('returns nothing when the month has no spend', () => {
    expect(computeDonutSegments([], new Map(), categories, 0, 'expense')).toEqual([])
  })

  // A category whose rows are all excluded still has rows the user should be able to open. Without
  // a segment there is no card and no way into the detail sheet, so the transactions become
  // unreachable from this screen entirely.
  it('keeps a category whose transactions are all excluded, at zero', () => {
    const feed = [
      item({ id: 'a', amount: 100, date: '2026-08-01', categoryId: 'food' }),
      item({
        id: 'sweep',
        amount: 286,
        date: '2026-08-02',
        categoryId: 'rent',
        isBrokerageCashAccount: true,
        isSweptOutflow: true,
        hasCrossAccountCounterpart: false,
      }),
    ]
    const segments = computeDonutSegments(feed, new Map([['food', 100]]), categories, 100, 'expense')

    const rent = segments.find((s) => s.categoryId === 'rent')
    expect(rent?.amount).toBe(0)
    expect(rent?.percentage).toBe(0)
    // Counts what the sheet will list, excluded rows included — otherwise the row reads "0 txns"
    // and opens onto one.
    expect(rent?.transactionCount).toBe(1)
    // Zero sorts last, so it can never displace real spend.
    expect(segments.map((s) => s.categoryId)).toEqual(['food', 'rent'])
  })

  it('still shows zero cards when nothing in the month counts', () => {
    const feed = [
      item({
        id: 'sweep',
        amount: 286,
        date: '2026-08-02',
        categoryId: 'rent',
        isBrokerageCashAccount: true,
        isSweptOutflow: true,
        hasCrossAccountCounterpart: false,
      }),
    ]
    const segments = computeDonutSegments(feed, new Map(), categories, 0, 'expense')

    expect(segments.map((s) => s.categoryId)).toEqual(['rent'])
    expect(segments[0].amount).toBe(0)
    // No total to divide by — percentage must not come out NaN and poison the ring geometry.
    expect(segments[0].percentage).toBe(0)
  })

  // Its own leg sits on the income side by sign, but the sheet files it under the expense it paid
  // back and refuses to list it in income mode. A zero income card would open onto nothing.
  it('does not invent a zero income category from a reimbursement income leg', () => {
    const feed = [
      item({ id: 'reimb', amount: -60, date: '2026-08-01', categoryId: 'food', isReimbursementIncome: true }),
    ]

    expect(computeDonutSegments(feed, new Map(), categories, 0, 'income')).toEqual([])
  })

  it('keeps an uncategorized segment when its only rows are excluded', () => {
    const feed = [
      item({ id: 'sweep', amount: 286, date: '2026-08-02', isBrokerageCashAccount: true, isSweptOutflow: true }),
    ]
    const segments = computeDonutSegments(feed, new Map(), categories, 0, 'expense')

    expect(segments.map((s) => s.categoryId)).toEqual([UNCATEGORIZED_ID])
    expect(segments[0].amount).toBe(0)
  })

  it('sorts largest first', () => {
    const feed = [
      item({ id: 'a', amount: 20, date: '2026-08-01', categoryId: 'food' }),
      item({ id: 'b', amount: 80, date: '2026-08-02', categoryId: 'rent' }),
    ]
    const segments = computeDonutSegments(
      feed,
      new Map([['food', 20], ['rent', 80]]),
      categories,
      100,
      'expense',
    )

    expect(segments.map((s) => s.categoryId)).toEqual(['rent', 'food'])
  })
})
