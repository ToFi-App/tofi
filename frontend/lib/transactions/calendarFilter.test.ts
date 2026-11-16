import { describe, expect, it } from 'vitest'
import {
  activeFilterCount,
  applyCalendarFilter,
  EMPTY_CALENDAR_FILTER,
  kindOf,
  latestMonth,
  matchesCalendarFilter,
  matchingMonths,
  monthKey,
  type CalendarFilter,
} from './calendarFilter'
import type { FeedItem } from './resolveFeed'

function item(overrides: Partial<FeedItem> & { id: string }): FeedItem {
  return {
    source: 'plaid',
    amount: 10,
    date: '2026-06-01',
    postedDate: '2026-06-01',
    merchantName: 'Shop',
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
    reimbursementCategoryIds: [],
    transferId: null,
    transferKind: null,
    transferRole: null,
    transferSource: null,
    isBrokerageCashAccount: false,
    isSweptOutflow: false,
    hasCrossAccountCounterpart: false,
    links: [],
    ...overrides,
  }
}

function filter(overrides: Partial<CalendarFilter>): CalendarFilter {
  return { ...EMPTY_CALENDAR_FILTER, ...overrides }
}

const ids = (feed: FeedItem[]) => feed.map((i) => i.id)

describe('kindOf', () => {
  it('reads money out as expense and money in as income', () => {
    expect(kindOf(item({ id: 'a', amount: 12 }))).toBe('expense')
    expect(kindOf(item({ id: 'b', amount: -12 }))).toBe('income')
  })

  it('calls a transfer leg or a swept outflow a transfer, whichever way it went', () => {
    expect(kindOf(item({ id: 'a', amount: -50, transferKind: 'internal' as FeedItem['transferKind'] }))).toBe('transfer')
    expect(kindOf(item({ id: 'b', amount: 50, isSweptOutflow: true }))).toBe('transfer')
  })
})

describe('matchesCalendarFilter', () => {
  it('lets everything through with no filter set', () => {
    const feed = [item({ id: 'a' }), item({ id: 'b', amount: -5 })]
    expect(applyCalendarFilter(feed, EMPTY_CALENDAR_FILTER)).toBe(feed)
  })

  it('matches any picked type', () => {
    const feed = [
      item({ id: 'out', amount: 10 }),
      item({ id: 'in', amount: -10 }),
      item({ id: 'move', amount: 10, isSweptOutflow: true }),
    ]
    expect(ids(applyCalendarFilter(feed, filter({ kinds: ['income', 'transfer'] })))).toEqual(['in', 'move'])
  })

  it('matches picked categories, with null standing for Uncategorized', () => {
    const feed = [item({ id: 'a', categoryId: 'dining' }), item({ id: 'b', categoryId: 'rent' }), item({ id: 'c' })]
    expect(ids(applyCalendarFilter(feed, filter({ categoryIds: ['dining', null] })))).toEqual(['a', 'c'])
  })

  it('narrows only the category a picked subcategory belongs to', () => {
    const feed = [
      item({ id: 'coffee', categoryId: 'dining', subcategoryId: 'coffee' }),
      item({ id: 'dinner', categoryId: 'dining', subcategoryId: 'dinner' }),
      item({ id: 'groceries', categoryId: 'groceries' }),
      item({ id: 'rent', categoryId: 'rent' }),
    ]
    const result = applyCalendarFilter(
      feed,
      filter({ categoryIds: ['dining', 'groceries'], subcategories: [{ id: 'coffee', categoryId: 'dining' }] }),
    )
    expect(ids(result)).toEqual(['coffee', 'groceries'])
  })

  it('treats a subcategory picked on its own as picking its category too', () => {
    const feed = [
      item({ id: 'coffee', categoryId: 'dining', subcategoryId: 'coffee' }),
      item({ id: 'rent', categoryId: 'rent' }),
    ]
    expect(ids(applyCalendarFilter(feed, filter({ subcategories: [{ id: 'coffee', categoryId: 'dining' }] })))).toEqual([
      'coffee',
    ])
  })

  it('matches any picked flag', () => {
    const feed = [
      item({ id: 'pending', pending: true }),
      item({ id: 'reimbursed', reimbursedAmount: 5, netAmount: 5 }),
      item({ id: 'payback', amount: -5, isReimbursementIncome: true }),
      item({ id: 'plain' }),
    ]
    expect(ids(applyCalendarFilter(feed, filter({ flags: ['reimbursed'] })))).toEqual(['reimbursed', 'payback'])
    expect(ids(applyCalendarFilter(feed, filter({ flags: ['pending'] })))).toEqual(['pending'])
    // Pending doesn't count yet, and a reimbursement's income leg is netted out of its expense.
    expect(ids(applyCalendarFilter(feed, filter({ flags: ['notCounted'] })))).toEqual(['pending', 'payback'])
  })

  it('bounds the size of the row, whichever way the money went', () => {
    const feed = [item({ id: 'small', amount: 5 }), item({ id: 'mid', amount: -50 }), item({ id: 'big', amount: 500 })]
    expect(ids(applyCalendarFilter(feed, filter({ amountMin: 10, amountMax: 100 })))).toEqual(['mid'])
    expect(ids(applyCalendarFilter(feed, filter({ amountMin: 50 })))).toEqual(['mid', 'big'])
  })

  it('searches the merchant, the bank description and the note, ignoring case', () => {
    const feed = [
      item({ id: 'merchant', merchantName: 'Blue Bottle' }),
      item({ id: 'bank', merchantName: 'x', plaidName: 'SQ *BLUE BOTTLE' }),
      item({ id: 'note', merchantName: 'x', note: 'blue bottle with Sam' }),
      item({ id: 'other', merchantName: 'Safeway' }),
    ]
    expect(ids(applyCalendarFilter(feed, filter({ search: '  bottle ' })))).toEqual(['merchant', 'bank', 'note'])
  })

  it('requires every section to hold', () => {
    const row = item({ id: 'a', amount: 20, categoryId: 'dining', merchantName: 'Cafe' })
    expect(matchesCalendarFilter(row, filter({ kinds: ['expense'], categoryIds: ['dining'], search: 'cafe' }))).toBe(true)
    expect(matchesCalendarFilter(row, filter({ kinds: ['income'], categoryIds: ['dining'], search: 'cafe' }))).toBe(false)
  })
})

describe('activeFilterCount', () => {
  it('counts sections, not choices', () => {
    expect(activeFilterCount(EMPTY_CALENDAR_FILTER)).toBe(0)
    expect(activeFilterCount(filter({ kinds: ['income', 'expense'], amountMax: 10, search: ' ' }))).toBe(2)
  })
})

describe('matchingMonths', () => {
  it('collects the months that have a matching row', () => {
    const feed = [
      item({ id: 'a', date: '2026-03-14', categoryId: 'dining' }),
      item({ id: 'b', date: '2026-05-02', categoryId: 'rent' }),
      item({ id: 'c', date: '2026-07-30', categoryId: 'dining' }),
    ]
    expect([...matchingMonths(feed, filter({ categoryIds: ['dining'] }))].sort()).toEqual(['2026-03', '2026-07'])
  })
})

describe('latestMonth', () => {
  it('picks the latest month, across years', () => {
    expect(latestMonth(new Set(['2025-12', '2026-02', '2026-01']))).toEqual({ year: 2026, month: 2 })
    expect(latestMonth(new Set())).toBeNull()
  })
})

describe('monthKey', () => {
  it('pads the month', () => {
    expect(monthKey({ year: 2026, month: 3 })).toBe('2026-03')
  })
})
