import type { FeedItem } from '@/lib/transactions/resolveFeed'
import { filterByMonth, shiftMonth, type YearMonth } from '@/lib/transactions/filterByMonth'
import { countsTowardTotals } from '@/lib/transactions/totals'
import type { DayPoint } from '@/lib/transactions/visualizationData'

export interface CumulativePoint {
  day: number
  /** Everything spent from the 1st through this day. */
  total: number
}

export interface MonthComparison {
  /** The viewed month's running total, through today for the current month. */
  current: CumulativePoint[]
  /** The month before, in full. */
  previous: CumulativePoint[]
  currentTotal: number
  /**
   * What the month before had spent by the same day of the month — the fair thing to compare a
   * month in progress against. Its full total would make every month look thrifty until its last
   * week. A day past the previous month's end (the 31st against a 30-day month) takes its total.
   */
  previousAtSameDay: number
  /** currentTotal relative to previousAtSameDay; null when there is nothing to compare against. */
  change: number | null
}

export function cumulativeSpend(points: DayPoint[]): CumulativePoint[] {
  let total = 0
  return points.map(({ day, amount }) => {
    total += amount
    return { day, total }
  })
}

/** Pure half of compareWithPreviousMonth, over daily points already computed for each month. */
export function compareDailySpend(currentDays: DayPoint[], previousDays: DayPoint[]): MonthComparison {
  const current = cumulativeSpend(currentDays)
  const previous = cumulativeSpend(previousDays)
  const currentTotal = current.at(-1)?.total ?? 0
  const throughDay = current.at(-1)?.day ?? 0
  const previousAtSameDay = [...previous].reverse().find((point) => point.day <= throughDay)?.total ?? 0
  const change = previousAtSameDay > 0 ? (currentTotal - previousAtSameDay) / previousAtSameDay : null
  return { current, previous, currentTotal, previousAtSameDay, change }
}

/**
 * Spending per day, counted the way Home's Expenses total counts it, through the later of today and
 * the last day anything was spent.
 *
 * Not computeDailyPoints: it stops at today, and transactions carry the bank's date, so on a US
 * evening the day's purchases can already be dated tomorrow. Dropping those left this total short
 * of Home's for the same month.
 */
function dailySpend(monthFeed: FeedItem[], month: YearMonth, today: Date): DayPoint[] {
  const daysInMonth = new Date(month.year, month.month, 0).getDate()
  const isCurrentMonth = month.year === today.getFullYear() && month.month === today.getMonth() + 1
  let lastDay = isCurrentMonth ? today.getDate() : daysInMonth
  const amounts = new Map<number, number>()
  for (const item of monthFeed) {
    if (!countsTowardTotals(item)) continue
    const net = item.netAmount ?? item.amount
    if (net <= 0) continue
    const day = parseInt(item.date.split('-')[2], 10)
    amounts.set(day, (amounts.get(day) ?? 0) + net)
    lastDay = Math.max(lastDay, day)
  }
  return Array.from({ length: Math.min(lastDay, daysInMonth) }, (_, i) => ({ day: i + 1, amount: amounts.get(i + 1) ?? 0 }))
}

/**
 * The viewed month's spending against the month before, day by day. Counts what Home's Expenses
 * total counts — every category, budgeted or not — since this answers "am I spending more than
 * last month", not "am I inside my budgets".
 */
export function compareWithPreviousMonth(feed: FeedItem[], month: YearMonth, today: Date = new Date()): MonthComparison {
  const previousMonth = shiftMonth(month, -1)
  return compareDailySpend(
    dailySpend(filterByMonth(feed, month), month, today),
    dailySpend(filterByMonth(feed, previousMonth), previousMonth, today),
  )
}
