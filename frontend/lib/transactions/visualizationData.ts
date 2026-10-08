import { FALLBACK_ICON_SLUG } from '@/lib/categories/icons'
import { countsTowardTotals, hasReimbursementSurplus } from './totals'
import type { FeedItem } from './resolveFeed'
import type { YearMonth } from './filterByMonth'

// Stands in for "no category" wherever a segment needs an id. Deliberately not a valid category
// id, so it can never collide with a real one.
export const UNCATEGORIZED_ID = '__uncategorized__'
export const UNCATEGORIZED_NAME = 'Uncategorized'
export const UNCATEGORIZED_ICON = FALLBACK_ICON_SLUG
export const UNCATEGORIZED_COLOR = '#A8A89C'

export interface DonutSegment {
  categoryId: string
  name: string
  icon: string
  color: string
  amount: number
  percentage: number
  transactionCount: number
}

export interface DayPoint {
  day: number
  amount: number
}

export function computeDonutSegments(
  feed: FeedItem[],
  amountByCategory: Map<string, number>,
  categories: Array<{ id: string; name: string; icon: string; color: string }>,
  total: number,
  mode: 'expense' | 'income',
): DonutSegment[] {
  // Counts every row the detail sheet will list, excluded ones included — the count labels that
  // list, so filtering on countsTowardTotals here made a category read "2 txns" and open onto 3.
  // It is also what keeps a category whose rows are ALL excluded on screen at zero: without an
  // entry there is no card, and those transactions become unreachable from this screen entirely.
  //
  // A reimbursement's income leg is the one exclusion, and it is not about totals: the sheet files
  // that leg under the expense it paid back and refuses to list it in income mode, so counting it
  // here would conjure a zero income category that opens onto nothing. One with a surplus is the
  // exception both ways — that part is income, and the sheet lists it under its own category.
  const countByCategory = new Map<string, number>()
  let uncategorizedCount = 0
  for (const item of feed) {
    if (item.isReimbursementIncome && !hasReimbursementSurplus(item)) continue
    const net = item.netAmount ?? item.amount
    const isRelevant = mode === 'expense' ? net > 0 : net < 0
    if (!isRelevant) continue
    if (item.categoryId) {
      countByCategory.set(item.categoryId, (countByCategory.get(item.categoryId) ?? 0) + 1)
    } else {
      uncategorizedCount++
    }
  }

  // Zero-amount segments are deliberately not drawable: CategoryDonut skips them, so they cost the
  // ring neither an arc nor a gap. They exist for the card grid and the breakdown list.
  const percentageOf = (amount: number) => (total > 0 ? (amount / total) * 100 : 0)

  const segments: DonutSegment[] = []
  let categorizedTotal = 0
  for (const cat of categories) {
    const amount = amountByCategory.get(cat.id) ?? 0
    if (amount <= 0 && !countByCategory.has(cat.id)) continue
    if (amount > 0) categorizedTotal += amount
    segments.push({
      categoryId: cat.id,
      name: cat.name,
      icon: cat.icon,
      color: cat.color,
      amount: Math.max(0, amount),
      percentage: percentageOf(Math.max(0, amount)),
      transactionCount: countByCategory.get(cat.id) ?? 0,
    })
  }

  const uncategorizedAmount = total - categorizedTotal
  if (uncategorizedAmount > 0.01 || uncategorizedCount > 0) {
    const amount = Math.max(0, uncategorizedAmount)
    segments.push({
      categoryId: UNCATEGORIZED_ID,
      name: UNCATEGORIZED_NAME,
      icon: UNCATEGORIZED_ICON,
      color: UNCATEGORIZED_COLOR,
      amount,
      percentage: percentageOf(amount),
      transactionCount: uncategorizedCount,
    })
  }

  return segments.sort((a, b) => b.amount - a.amount)
}

export interface MerchantTotal {
  name: string
  amount: number
  count: number
}

export function computeTopMerchants(
  feed: FeedItem[],
  mode: 'expense' | 'income',
  limit = 5,
): MerchantTotal[] {
  const byMerchant = new Map<string, { amount: number; count: number }>()
  for (const item of feed) {
    if (!countsTowardTotals(item)) continue
    const net = item.netAmount ?? item.amount
    const isRelevant = mode === 'expense' ? net > 0 : net < 0
    if (!isRelevant) continue
    const existing = byMerchant.get(item.merchantName) ?? { amount: 0, count: 0 }
    existing.amount += Math.abs(net)
    existing.count++
    byMerchant.set(item.merchantName, existing)
  }

  return Array.from(byMerchant.entries())
    .map(([name, { amount, count }]) => ({ name, amount, count }))
    .sort((a, b) => b.amount - a.amount)
    .slice(0, limit)
}

export function computeDailyPoints(feed: FeedItem[], month: YearMonth, mode: 'expense' | 'income'): DayPoint[] {
  const daysInMonth = new Date(month.year, month.month, 0).getDate()
  const today = new Date()
  const isCurrentMonth = month.year === today.getFullYear() && month.month === today.getMonth() + 1
  const maxDay = isCurrentMonth ? today.getDate() : daysInMonth

  const dailyAmounts = new Map<number, number>()
  for (const item of feed) {
    if (!countsTowardTotals(item)) continue
    const net = item.netAmount ?? item.amount
    const isRelevant = mode === 'expense' ? net > 0 : net < 0
    if (!isRelevant) continue
    const day = parseInt(item.date.split('-')[2], 10)
    if (day > maxDay) continue
    dailyAmounts.set(day, (dailyAmounts.get(day) ?? 0) + Math.abs(net))
  }

  const points: DayPoint[] = []
  for (let day = 1; day <= maxDay; day++) {
    points.push({ day, amount: dailyAmounts.get(day) ?? 0 })
  }
  return points
}
