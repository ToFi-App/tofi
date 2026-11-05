import { shiftMonth, type YearMonth } from '@/lib/transactions/filterByMonth'

/** Days at the end of a month when its review is offered, and at the start of the next when last month's is. */
const CLOSING_DAYS = 5
const OPENING_DAYS = 7

export interface ReviewPrompt {
  /** The month the cash flow screen opens on. */
  month: YearMonth
  /** A month worth reviewing as a whole — past, or nearly over — rather than a glance at one in progress. */
  isReady: boolean
}

/**
 * Which month Home's cash flow card points at, and whether it is the moment for a review.
 *
 * Cash flow is read at the turn of the month, so that's when the card speaks up: in a month's last
 * days it offers that month, and in the first week of the next it offers the one just finished —
 * a review of three days of a new month would be nearly empty. Any past month viewed is ready.
 */
export function reviewPrompt(viewed: YearMonth, today: Date): ReviewPrompt {
  const current = { year: today.getFullYear(), month: today.getMonth() + 1 }
  const viewedKey = viewed.year * 12 + viewed.month
  const currentKey = current.year * 12 + current.month
  if (viewedKey < currentKey) return { month: viewed, isReady: true }
  if (viewedKey > currentKey) return { month: viewed, isReady: false }
  const daysInMonth = new Date(current.year, current.month, 0).getDate()
  if (daysInMonth - today.getDate() < CLOSING_DAYS) return { month: current, isReady: true }
  if (today.getDate() <= OPENING_DAYS) return { month: shiftMonth(current, -1), isReady: true }
  return { month: current, isReady: false }
}
