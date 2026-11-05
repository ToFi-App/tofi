import type { FeedItem } from './resolveFeed'

export interface YearMonth {
  year: number
  month: number // 1-12
}

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
]

function monthPrefix({ year, month }: YearMonth): string {
  return `${year}-${String(month).padStart(2, '0')}`
}

export function filterByMonth(feed: FeedItem[], month: YearMonth): FeedItem[] {
  const prefix = monthPrefix(month)
  return feed.filter((item) => item.date.startsWith(prefix))
}

export function shiftMonth({ year, month }: YearMonth, delta: 1 | -1): YearMonth {
  const zeroBased = month - 1 + delta
  const newYear = year + Math.floor(zeroBased / 12)
  const newMonth = ((zeroBased % 12) + 12) % 12
  return { year: newYear, month: newMonth + 1 }
}

export function monthLabel({ year, month }: YearMonth): string {
  return `${MONTH_NAMES[month - 1]} ${year}`
}

export function currentMonth(): YearMonth {
  const now = new Date()
  return { year: now.getFullYear(), month: now.getMonth() + 1 }
}

/** The month a pushed screen was opened for, from its route params; the current month if absent or malformed. */
export function monthFromParams(params: { year?: string; month?: string }): YearMonth {
  const year = Number(params.year)
  const month = Number(params.month)
  if (Number.isInteger(year) && Number.isInteger(month) && month >= 1 && month <= 12) return { year, month }
  return currentMonth()
}
