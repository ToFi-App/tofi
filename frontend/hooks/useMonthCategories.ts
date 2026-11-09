import { useEffect, useMemo, useState } from 'react'
import { useTransactionFeed } from '@/hooks/useTransactionFeed'
import { useBudgets } from '@/hooks/useBudgets'
import { useCategories } from '@/hooks/useCategories'
import { useSelectedMonth } from '@/hooks/useSelectedMonth'
import { useSelectedAccountFilter } from '@/hooks/useSelectedAccountFilter'
import { filterByMonth } from '@/lib/transactions/filterByMonth'
import { aggregateMonth } from '@/lib/transactions/aggregateMonth'
import { hasReimbursementSurplus } from '@/lib/transactions/totals'
import { UNCATEGORIZED_ID, computeDonutSegments, type DonutSegment } from '@/lib/transactions/visualizationData'
import { monthElapsedFraction, resolveBudgetsForMonth } from '@/lib/budgets/budgetMath'
import { arrangeTiles, tileState } from '@/lib/home/categoryTiles'
import type { GridTile } from '@/components/home/TileRows'

export type CategoryMode = 'expense' | 'income'

/**
 * The viewed month's categories — Home's month and account filter — as tiles, with the detail sheet
 * a tile opens. Shared by Home's preview cards and the full Expenses / Income page, so the two can
 * never disagree on an amount, a ring, or what a tile opens.
 */
export function useMonthCategories() {
  const [month] = useSelectedMonth()
  const [selectedAccountId] = useSelectedAccountFilter()
  const [detailState, setDetailState] = useState<{ segment: DonutSegment; mode: CategoryMode } | null>(null)

  const { feed } = useTransactionFeed()
  const budgets = useBudgets()
  const categories = useCategories()

  const accountFilteredFeed = useMemo(
    () => (selectedAccountId ? feed.filter((item) => item.accountId === selectedAccountId) : feed),
    [feed, selectedAccountId],
  )
  const monthFeed = useMemo(() => filterByMonth(accountFilteredFeed, month), [accountFilteredFeed, month])
  const { spendByCategory, incomeByCategory, totalExpense, totalIncome } = useMemo(() => aggregateMonth(monthFeed), [monthFeed])

  // Budgets are effective-dated: the ring on each card must reflect the amount in force for the
  // viewed month (and vanish for months where the budget didn't exist or was stopped).
  const resolvedBudgets = useMemo(() => resolveBudgetsForMonth(budgets.data ?? [], month), [budgets.data, month])
  const elapsed = monthElapsedFraction(month)

  // The category cards open the same detail sheet the donut chart does, so their segments are
  // built the same way — otherwise a card and its chart slice could disagree on percentage or
  // transaction count for the same category.
  const expenseSegments = useMemo(
    () => computeDonutSegments(monthFeed, spendByCategory, categories.data ?? [], totalExpense, 'expense'),
    [monthFeed, spendByCategory, categories.data, totalExpense],
  )
  const incomeSegments = useMemo(
    () => computeDonutSegments(monthFeed, incomeByCategory, categories.data ?? [], totalIncome, 'income'),
    [monthFeed, incomeByCategory, categories.data, totalIncome],
  )

  const detailTransactions = useMemo(() => {
    if (!detailState) return []
    return monthFeed
      .filter((item) => {
        const isUncategorized = detailState.segment.categoryId === UNCATEGORIZED_ID
        // A reimbursement's income leg keeps its place in the list, under the expense it paid
        // back — that netting is the reason the expense above it reads lower than the charge, and
        // dropping the row left it unexplained. It adds nothing to the totals (the day header
        // filters on countsTowardTotals), and it's matched on the expense's category rather than
        // its own, which is where the money it offsets sits.
        if (item.isReimbursementIncome && detailState.mode === 'expense') {
          // A split income shows under every category it paid back into.
          return isUncategorized
            ? item.reimbursementCategoryId === null
            : item.reimbursementCategoryIds.includes(detailState.segment.categoryId)
        }
        // In income mode only a surplus belongs — the part beyond the expense, which is income
        // under the leg's own category and falls through to the ordinary check below.
        if (item.isReimbursementIncome && !hasReimbursementSurplus(item)) return false
        if (isUncategorized ? item.categoryId !== null : item.categoryId !== detailState.segment.categoryId) return false
        const net = item.netAmount ?? item.amount
        // An expense paid back in full nets to zero but stays listed: its reimbursement is listed
        // above, and without the charge beside it that row would explain nothing. It still adds
        // nothing to the day header, which counts the net.
        if (detailState.mode === 'expense') return net > 0 || (item.reimbursedAmount != null && item.amount > 0)
        return net < 0
      })
      .sort((a, b) => (a.date < b.date ? 1 : -1))
  }, [monthFeed, detailState])

  // Must be the full segment list, uncategorized slice included: the sheet's donut draws each
  // segment's percentage of the month total, so leaving any spend out draws a gap in the ring.
  const detailSegments = detailState == null ? [] : detailState.mode === 'expense' ? expenseSegments : incomeSegments

  // Edits made from inside the sheet (a reimbursement, a transfer, a recategorisation) rewrite
  // this month's numbers under it, but `detailState.segment` is a snapshot from open time. Keep
  // it honest: when the segment no longer exists or has nothing left to show, bring the user
  // back instead of a stale ring over "No transactions"; otherwise refresh the snapshot so the
  // header amount matches the list below it.
  useEffect(() => {
    if (!detailState) return
    const fresh = (detailState.mode === 'expense' ? expenseSegments : incomeSegments).find(
      (s) => s.categoryId === detailState.segment.categoryId,
    )
    if (!fresh || detailTransactions.length === 0) {
      setDetailState(null)
      return
    }
    if (fresh.amount !== detailState.segment.amount || fresh.percentage !== detailState.segment.percentage) {
      setDetailState({ segment: fresh, mode: detailState.mode })
    }
  }, [detailState, expenseSegments, incomeSegments, detailTransactions])

  /** Open the sheet on a segment directly, as the Charts donut does. */
  function openSegment(segment: DonutSegment, mode: CategoryMode) {
    setDetailState({ segment, mode })
  }

  function openCategoryDetail(categoryId: string, mode: CategoryMode) {
    const segment = (mode === 'expense' ? expenseSegments : incomeSegments).find((s) => s.categoryId === categoryId)
    if (!segment) return
    setDetailState({ segment, mode })
  }

  // Driven by the segments, not by spendByCategory: a category whose transactions are all excluded
  // has no entry in that map but does have a segment (at zero), and it needs a card — the card is
  // the only way into its detail sheet, and without one those rows are unreachable from here.
  // Filtering `categories` rather than mapping the segments keeps the grid in category order.
  const expenseSegmentIds = new Set(expenseSegments.map((s) => s.categoryId))
  const incomeSegmentIds = new Set(incomeSegments.map((s) => s.categoryId))
  const expenseCategories = categories.data?.filter((c) => expenseSegmentIds.has(c.id)) ?? []
  const incomeCategories = categories.data?.filter((c) => incomeSegmentIds.has(c.id)) ?? []

  // Uncategorized isn't a real category, so it has no row in `categories` to filter for — it's
  // whatever the month total has left over once the real categories are accounted for. Without a
  // card for it the grid silently understates the month.
  const uncategorizedExpense = expenseSegments.find((s) => s.categoryId === UNCATEGORIZED_ID)
  const uncategorizedIncome = incomeSegments.find((s) => s.categoryId === UNCATEGORIZED_ID)

  function tileFor(
    category: { id: string; name: string; icon: string | null; color: string },
    spent: number,
    mode: CategoryMode,
  ): Omit<GridTile, 'wide'> {
    const budget = mode === 'expense' ? (resolvedBudgets.get(category.id)?.amount ?? null) : null
    return {
      ...category,
      spent,
      budget,
      state: tileState(spent, budget, elapsed),
      onPress: () => openCategoryDetail(category.id, mode),
    }
  }

  const expenseTiles: GridTile[] = arrangeTiles(
    [
      ...expenseCategories.map((c) => tileFor(c, spendByCategory.get(c.id) ?? 0, 'expense')),
      ...(uncategorizedExpense
        ? [tileFor({ ...uncategorizedExpense, id: UNCATEGORIZED_ID }, uncategorizedExpense.amount, 'expense')]
        : []),
    ],
    totalExpense,
  )
  const incomeTiles: GridTile[] = [
    ...incomeCategories.map((c) => tileFor(c, incomeByCategory.get(c.id) ?? 0, 'income')),
    ...(uncategorizedIncome
      ? [tileFor({ ...uncategorizedIncome, id: UNCATEGORIZED_ID }, uncategorizedIncome.amount, 'income')]
      : []),
  ].map((tile) => ({ ...tile, wide: false }))

  return {
    month,
    accountFilteredFeed,
    monthFeed,
    spendByCategory,
    incomeByCategory,
    totalExpense,
    totalIncome,
    resolvedBudgets,
    elapsed,
    expenseTiles,
    incomeTiles,
    openSegment,
    /** Props for CategoryDetailSheet. */
    detail: {
      visible: detailState != null,
      segment: detailState?.segment ?? null,
      allSegments: detailSegments,
      transactions: detailTransactions,
      onClose: () => setDetailState(null),
    },
  }
}
