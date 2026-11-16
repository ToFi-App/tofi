import type { FeedItem } from './resolveFeed'
import { countsTowardTotals, isInternalMovement } from './totals'

/** What a row is, for the filter's Type section. */
export type FilterKind = 'income' | 'expense' | 'transfer'

/** The filter's Other section: properties a row has or doesn't. */
export type FilterFlag = 'reimbursed' | 'pending' | 'notCounted'

/**
 * The Calendar tab's filter. Within a section the choices are alternatives (any of them matches);
 * across sections they all have to hold. An empty section, or a null bound, places no limit.
 *
 * It decides which rows the calendar shows — and so what its day shading and month totals add up —
 * but never whether a shown row counts. That stays countsTowardTotals' call, so filtering to
 * transfers shows the transfers with totals of zero, which is the truth about them.
 */
export interface CalendarFilter {
  kinds: FilterKind[]
  /** null stands for Uncategorized. */
  categoryIds: (string | null)[]
  /**
   * Picked subcategories, each with the category it belongs to. One narrows only its own category:
   * Dining › Coffee alongside Groceries still shows every grocery row.
   */
  subcategories: { id: string; categoryId: string }[]
  flags: FilterFlag[]
  /** Bounds on the row's size, whichever way the money went. */
  amountMin: number | null
  amountMax: number | null
  /** Matched against the merchant, the bank's own description and the note, ignoring case. */
  search: string
}

export const EMPTY_CALENDAR_FILTER: CalendarFilter = {
  kinds: [],
  categoryIds: [],
  subcategories: [],
  flags: [],
  amountMin: null,
  amountMax: null,
  search: '',
}

export function kindOf(item: FeedItem): FilterKind {
  if (isInternalMovement(item) || item.isSweptOutflow) return 'transfer'
  return item.amount < 0 ? 'income' : 'expense'
}

function hasFlag(item: FeedItem, flag: FilterFlag): boolean {
  switch (flag) {
    case 'reimbursed':
      return item.reimbursedAmount != null || item.isReimbursementIncome
    case 'pending':
      return item.pending
    case 'notCounted':
      return !countsTowardTotals(item)
  }
}

function matchesCategory(item: FeedItem, filter: CalendarFilter): boolean {
  if (filter.categoryIds.length === 0 && filter.subcategories.length === 0) return true
  // A subcategory can be picked without its category; the category is implied by it.
  const pickedCategory =
    filter.categoryIds.includes(item.categoryId) ||
    filter.subcategories.some((sub) => sub.categoryId === item.categoryId)
  if (!pickedCategory) return false
  const subsOfCategory = filter.subcategories.filter((sub) => sub.categoryId === item.categoryId)
  if (subsOfCategory.length === 0) return true
  return subsOfCategory.some((sub) => sub.id === item.subcategoryId)
}

export function matchesCalendarFilter(item: FeedItem, filter: CalendarFilter): boolean {
  if (filter.kinds.length > 0 && !filter.kinds.includes(kindOf(item))) return false
  if (!matchesCategory(item, filter)) return false
  if (filter.flags.length > 0 && !filter.flags.some((flag) => hasFlag(item, flag))) return false

  const size = Math.abs(item.amount)
  if (filter.amountMin != null && size < filter.amountMin) return false
  if (filter.amountMax != null && size > filter.amountMax) return false

  const query = filter.search.trim().toLowerCase()
  if (query) {
    const haystack = [item.merchantName, item.plaidName, item.note]
    if (!haystack.some((text) => text?.toLowerCase().includes(query))) return false
  }
  return true
}

export function applyCalendarFilter(feed: FeedItem[], filter: CalendarFilter): FeedItem[] {
  return activeFilterCount(filter) === 0 ? feed : feed.filter((item) => matchesCalendarFilter(item, filter))
}

/** How many sections are narrowing the view — the badge on the filter button. */
export function activeFilterCount(filter: CalendarFilter): number {
  return [
    filter.kinds.length > 0,
    filter.categoryIds.length > 0 || filter.subcategories.length > 0,
    filter.flags.length > 0,
    filter.amountMin != null || filter.amountMax != null,
    filter.search.trim() !== '',
  ].filter(Boolean).length
}

/** "2026-06" for June 2026 — how months are keyed in matchingMonths. */
export function monthKey(month: { year: number; month: number }): string {
  return `${month.year}-${String(month.month).padStart(2, '0')}`
}

/** Every month with at least one row the filter lets through, keyed as monthKey does. */
export function matchingMonths(feed: FeedItem[], filter: CalendarFilter): Set<string> {
  const months = new Set<string>()
  for (const item of applyCalendarFilter(feed, filter)) months.add(item.date.slice(0, 7))
  return months
}

/** The latest of a set of month keys, as a year and month; null for none. */
export function latestMonth(months: Set<string>): { year: number; month: number } | null {
  let latest: string | null = null
  for (const key of months) if (latest == null || key > latest) latest = key
  if (latest == null) return null
  const [year, month] = latest.split('-').map(Number)
  return { year, month }
}
