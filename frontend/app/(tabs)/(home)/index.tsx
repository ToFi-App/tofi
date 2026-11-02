import { useEffect, useMemo, useState } from 'react'
import { Pressable, ScrollView, Text, View, useWindowDimensions } from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import { SafeAreaView } from 'react-native-safe-area-context'
import { router } from 'expo-router'
import { colors } from '@/constants/theme'
import { useTransactionFeed } from '@/hooks/useTransactionFeed'
import { usePullToRefresh } from '@/hooks/usePullToRefresh'
import { useAccounts } from '@/hooks/useAccounts'
import { useBudgets } from '@/hooks/useBudgets'
import { useCategories } from '@/hooks/useCategories'
import { MonthNavigator } from '@/components/transactions/MonthNavigator'
import { AccountsFilterDropdown } from '@/components/ui/AccountsFilterDropdown'
import { ErrorBanner } from '@/components/ui/ErrorBanner'
import { EmptyState } from '@/components/ui/EmptyState'
import { LoadingScreen } from '@/components/ui/LoadingScreen'
import { Pill } from '@/components/ui/RangePills'
import { MonthCharts } from '@/components/visualizations/MonthCharts'
import { CategoryDetailSheet } from '@/components/visualizations/CategoryDetailSheet'
import { filterByMonth, shiftMonth } from '@/lib/transactions/filterByMonth'
import { useSelectedMonth } from '@/hooks/useSelectedMonth'
import { useSelectedAccountFilter } from '@/hooks/useSelectedAccountFilter'
import { aggregateMonth } from '@/lib/transactions/aggregateMonth'
import { hasReimbursementSurplus } from '@/lib/transactions/totals'
import { UNCATEGORIZED_ID, computeDonutSegments } from '@/lib/transactions/visualizationData'
import type { DonutSegment } from '@/lib/transactions/visualizationData'
import { budgetStatus, monthElapsedFraction, resolveBudgetsForMonth } from '@/lib/budgets/budgetMath'
import { compareWithPreviousMonth } from '@/lib/budgets/monthComparison'
import { reviewPrompt } from '@/lib/cashflow/reviewPrompt'
import { arrangeTiles, tileState } from '@/lib/home/categoryTiles'
import { MonthOverviewCard } from '@/components/home/MonthOverviewCard'
import { TileRows, type GridTile } from '@/components/home/TileRows'
import { useTransactionEditorActions } from '@/components/transactions/TransactionEditorProvider'
import type { YearMonth } from '@/lib/transactions/filterByMonth'

/** The screen's side padding (px-5) and the grid's gutter. */
const SCREEN_PADDING = 20
const TILE_GAP = 10
const TILE_HEIGHT = 116

export default function DashboardScreen() {
  const [month, setMonth] = useSelectedMonth()
  const [selectedAccountId, setSelectedAccountId] = useSelectedAccountFilter()
  const [expensesOpen, setExpensesOpen] = useState(true)
  const [incomeOpen, setIncomeOpen] = useState(true)
  const [view, setView] = useState<'grid' | 'chart'>('grid')
  const [detailState, setDetailState] = useState<{ segment: DonutSegment; mode: 'expense' | 'income' } | null>(null)

  const { feed, isLoading, error, refresh } = useTransactionFeed()
  const refreshControl = usePullToRefresh(refresh)
  const accounts = useAccounts()
  const budgets = useBudgets()
  const categories = useCategories()
  const { openNewManual } = useTransactionEditorActions()

  const accountFilteredFeed = useMemo(
    () => (selectedAccountId ? feed.filter((item) => item.accountId === selectedAccountId) : feed),
    [feed, selectedAccountId],
  )
  const monthFeed = useMemo(() => filterByMonth(accountFilteredFeed, month), [accountFilteredFeed, month])

  const { spendByCategory, incomeByCategory, totalExpense, totalIncome } = useMemo(
    () => aggregateMonth(monthFeed),
    [monthFeed],
  )

  const { width: windowWidth } = useWindowDimensions()
  const tileWidth = (windowWidth - SCREEN_PADDING * 2 - TILE_GAP * 2) / 3

  // Budgets are effective-dated: the ring on each card must reflect the amount in force for the
  // viewed month (and vanish for months where the budget didn't exist or was stopped).
  const resolvedBudgets = useMemo(() => resolveBudgetsForMonth(budgets.data ?? [], month), [budgets.data, month])

  const elapsed = monthElapsedFraction(month)
  const isCurrentMonth = elapsed > 0 && elapsed < 1

  // The tiles' rings summed, for the overview card's budget bar.
  const monthBudget = useMemo(() => {
    if (resolvedBudgets.size === 0) return null
    let budget = 0
    let spent = 0
    for (const resolved of resolvedBudgets.values()) {
      budget += resolved.amount
      spent += spendByCategory.get(resolved.categoryId) ?? 0
    }
    return { budget, spent, status: budgetStatus(spent, budget, elapsed), elapsed }
  }, [resolvedBudgets, spendByCategory, elapsed])
  // This month against last as running totals — every category, budgeted or not — for the chart view.
  const comparison = useMemo(() => compareWithPreviousMonth(accountFilteredFeed, month), [accountFilteredFeed, month])

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
          return isUncategorized
            ? item.reimbursementCategoryId === null
            : item.reimbursementCategoryId === detailState.segment.categoryId
        }
        // In income mode only a surplus belongs — the part beyond the expense, which is income
        // under the leg's own category and falls through to the ordinary check below.
        if (item.isReimbursementIncome && !hasReimbursementSurplus(item)) return false
        if (isUncategorized ? item.categoryId !== null : item.categoryId !== detailState.segment.categoryId)
          return false
        const net = item.netAmount ?? item.amount
        return detailState.mode === 'expense' ? net > 0 : net < 0
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

  const hasNoAccounts = !accounts.isLoading && (accounts.data?.length ?? 0) === 0

  if (isLoading) return <LoadingScreen />

  if (hasNoAccounts) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }} edges={['top']}>
        <EmptyState message="Link an account in Settings to see your spending here." />
      </SafeAreaView>
    )
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

  function openCategoryDetail(categoryId: string, mode: 'expense' | 'income') {
    const segment = (mode === 'expense' ? expenseSegments : incomeSegments).find((s) => s.categoryId === categoryId)
    if (!segment) return
    setDetailState({ segment, mode })
  }

  const monthParams = (target: YearMonth) => ({ year: String(target.year), month: String(target.month) })

  // The same header row as Net Worth and Investments — which view on the left, the page's controls
  // on the right — with the month, Home's subject, as the title under it.
  const topBar = (
    <View className="gap-3">
      <View className="flex-row items-center justify-between">
        <View className="flex-row gap-2">
          <Pill label="Summary" isSelected={view === 'grid'} onPress={() => setView('grid')} />
          <Pill label="Charts" isSelected={view === 'chart'} onPress={() => setView('chart')} />
        </View>
        <View className="flex-row items-center gap-4">
          <AccountsFilterDropdown variant="icon" accounts={accounts.data ?? []} selectedAccountId={selectedAccountId} onSelect={setSelectedAccountId} />
          <Pressable onPress={openNewManual} hitSlop={8} accessibilityLabel="Write a transaction">
            <Ionicons name="create-outline" size={24} color={colors.textPrimary} />
          </Pressable>
        </View>
      </View>
      <MonthNavigator
        variant="title"
        month={month}
        onPrevious={() => setMonth(shiftMonth(month, -1))}
        onNext={() => setMonth(shiftMonth(month, 1))}
        onSelect={setMonth}
      />
    </View>
  )


  function tileFor(
    category: { id: string; name: string; icon: string | null; color: string },
    spent: number,
    mode: 'expense' | 'income',
  ): Omit<GridTile, 'wide'> {
    const budget = mode === 'expense' ? (resolvedBudgets.get(category.id)?.amount ?? null) : null
    const state = tileState(spent, budget, elapsed)
    return {
      ...category,
      spent,
      budget,
      state,
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
    ...(uncategorizedIncome ? [tileFor({ ...uncategorizedIncome, id: UNCATEGORIZED_ID }, uncategorizedIncome.amount, 'income')] : []),
  ].map((tile) => ({ ...tile, wide: false }))

  // Save errors are reported by the edit sheets themselves (CategoryDetailSheet owns the editor),
  // so this screen only surfaces its own data-loading failure.
  const errorBanner = error ? <ErrorBanner message="Something went wrong loading your data." /> : null

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }} edges={['top']}>
      {view === 'chart' ? (
        <>
          <View className="px-5 pt-4 pb-2" style={{ gap: 12 }}>
            {topBar}
            {errorBanner}
          </View>
          <MonthCharts
            monthFeed={monthFeed}
            categories={categories.data ?? []}
            spendByCategory={spendByCategory}
            incomeByCategory={incomeByCategory}
            totalExpense={totalExpense}
            totalIncome={totalIncome}
            month={month}
            onSegmentPress={(segment, mode) => setDetailState({ segment, mode })}
          />
        </>
      ) : (
        <ScrollView contentInsetAdjustmentBehavior="automatic" contentContainerClassName="gap-5 px-5 pb-8 pt-4" refreshControl={refreshControl}>
          {topBar}
          {errorBanner}

          {/* Pulled closer to the month title: the overview reads as that month's, not a section of its own. */}
          <View style={{ marginTop: -8 }}>
            <MonthOverviewCard
              month={month}
              totalExpense={totalExpense}
              totalIncome={totalIncome}
              comparison={comparison}
              isCurrentMonth={isCurrentMonth}
              budget={monthBudget}
              review={reviewPrompt(month, new Date())}
              onReviewPress={(target) => router.push({ pathname: '/(tabs)/(home)/cash-flow', params: monthParams(target) })}
              onBudgetPress={() => router.push({ pathname: '/(tabs)/(home)/budgets', params: monthParams(month) })}
            />
          </View>

          {/* Each group of tiles under its own heading that folds it away — no totals, the card above
              has them. The heading also marks where the overview ends and the categories begin. */}
          {expenseTiles.length > 0 ? (
            <View className="gap-3">
              <SectionToggle title="Expenses" isOpen={expensesOpen} onToggle={() => setExpensesOpen((v) => !v)} />
              {expensesOpen ? <TileRows tiles={expenseTiles} tileWidth={tileWidth} tileHeight={TILE_HEIGHT} gap={TILE_GAP} /> : null}
            </View>
          ) : null}

          {incomeTiles.length > 0 ? (
            <View className="gap-3">
              <SectionToggle title="Income" isOpen={incomeOpen} onToggle={() => setIncomeOpen((v) => !v)} />
              {incomeOpen ? <TileRows tiles={incomeTiles} tileWidth={tileWidth} tileHeight={TILE_HEIGHT} gap={TILE_GAP} /> : null}
            </View>
          ) : null}
        </ScrollView>
      )}


      <CategoryDetailSheet
        visible={detailState != null}
        segment={detailState?.segment ?? null}
        allSegments={detailSegments}
        transactions={detailTransactions}
        feed={feed}
        onClose={() => setDetailState(null)}
      />
    </SafeAreaView>
  )
}

/** A group's heading, left-aligned like a section title, that folds the group away. */
function SectionToggle({ title, isOpen, onToggle }: { title: string; isOpen: boolean; onToggle: () => void }) {
  return (
    <Pressable
      onPress={onToggle}
      accessibilityRole="button"
      accessibilityState={{ expanded: isOpen }}
      className="flex-row items-center gap-1.5 self-start pt-2"
    >
      <Text className="font-sansSemi text-md text-textPrimary">{title}</Text>
      <Ionicons name={isOpen ? 'chevron-up' : 'chevron-down'} size={16} color={colors.textSecondary} />
    </Pressable>
  )
}
