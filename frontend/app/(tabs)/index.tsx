import { useEffect, useMemo, useState } from 'react'
import { Pressable, ScrollView, Text, View } from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import { SafeAreaView } from 'react-native-safe-area-context'
import { router } from 'expo-router'
import { colors } from '@/constants/theme'
import { useTransactionFeed } from '@/hooks/useTransactionFeed'
import { usePullToRefresh } from '@/hooks/usePullToRefresh'
import { useAccounts } from '@/hooks/useAccounts'
import { useBudgets } from '@/hooks/useBudgets'
import { useCategories } from '@/hooks/useCategories'
import { CategoryCard } from '@/components/categories/CategoryCard'
import { MonthNavigator } from '@/components/transactions/MonthNavigator'
import { AccountsFilterDropdown } from '@/components/ui/AccountsFilterDropdown'
import { ErrorBanner } from '@/components/ui/ErrorBanner'
import { EmptyState } from '@/components/ui/EmptyState'
import { LoadingScreen } from '@/components/ui/LoadingScreen'
import { ViewTogglePill } from '@/components/visualizations/ViewTogglePill'
import { VisualizationPager } from '@/components/visualizations/VisualizationPager'
import { CategoryDetailSheet } from '@/components/visualizations/CategoryDetailSheet'
import { formatAmount } from '@/lib/format/money'
import { filterByMonth, shiftMonth } from '@/lib/transactions/filterByMonth'
import { useSelectedMonth } from '@/hooks/useSelectedMonth'
import { aggregateMonth } from '@/lib/transactions/aggregateMonth'
import { UNCATEGORIZED_ID, computeDonutSegments } from '@/lib/transactions/visualizationData'
import type { DonutSegment } from '@/lib/transactions/visualizationData'
import { resolveBudgetsForMonth } from '@/lib/budgets/budgetMath'

export default function DashboardScreen() {
  const [month, setMonth] = useSelectedMonth()
  const [selectedAccountId, setSelectedAccountId] = useState<string | null>(null)
  const [expensesOpen, setExpensesOpen] = useState(true)
  const [incomeOpen, setIncomeOpen] = useState(true)
  const [vizMode, setVizMode] = useState(false)
  const [detailState, setDetailState] = useState<{ segment: DonutSegment; mode: 'expense' | 'income' } | null>(null)

  const { feed, isLoading, error, refresh } = useTransactionFeed()
  const refreshControl = usePullToRefresh(refresh)
  const accounts = useAccounts()
  const budgets = useBudgets()
  const categories = useCategories()

  const accountFilteredFeed = useMemo(
    () => (selectedAccountId ? feed.filter((item) => item.accountId === selectedAccountId) : feed),
    [feed, selectedAccountId],
  )
  const monthFeed = useMemo(() => filterByMonth(accountFilteredFeed, month), [accountFilteredFeed, month])

  const { spendByCategory, incomeByCategory, totalExpense, totalIncome } = useMemo(
    () => aggregateMonth(monthFeed),
    [monthFeed],
  )

  // Budgets are effective-dated: the ring on each card must reflect the amount in force for the
  // viewed month (and vanish for months where the budget didn't exist or was stopped).
  const resolvedBudgets = useMemo(() => resolveBudgetsForMonth(budgets.data ?? [], month), [budgets.data, month])

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
        if (item.isReimbursementIncome) {
          if (detailState.mode !== 'expense') return false
          return isUncategorized
            ? item.reimbursementCategoryId === null
            : item.reimbursementCategoryId === detailState.segment.categoryId
        }
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

  const topBar = (
    <View className="flex-row items-center">
      <View className="flex-1 flex-row">
        <AccountsFilterDropdown accounts={accounts.data ?? []} selectedAccountId={selectedAccountId} onSelect={setSelectedAccountId} />
      </View>
      <MonthNavigator month={month} onPrevious={() => setMonth(shiftMonth(month, -1))} onNext={() => setMonth(shiftMonth(month, 1))} onSelect={setMonth} />
      <View className="flex-1 items-end">
        <Pressable
          onPress={() => router.push({ pathname: '/(tabs)/cash-flow', params: { year: String(month.year), month: String(month.month) } })}
          hitSlop={10}
          accessibilityLabel="Cash flow"
        >
          <Ionicons name="git-network-outline" size={22} color={colors.primary} />
        </Pressable>
      </View>
    </View>
  )

  // Save errors are reported by the edit sheets themselves (CategoryDetailSheet owns the editor),
  // so this screen only surfaces its own data-loading failure.
  const errorBanner = error ? <ErrorBanner message="Something went wrong loading your data." /> : null

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }} edges={['top']}>
      {vizMode ? (
        <>
          <View className="px-5 pt-4 pb-2" style={{ gap: 12 }}>
            {topBar}
            {errorBanner}
          </View>
          <VisualizationPager
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
        <ScrollView contentContainerClassName="gap-5 px-5 py-4" refreshControl={refreshControl}>
          {topBar}
          {errorBanner}

          <Pressable onPress={() => setExpensesOpen((v) => !v)} className="flex-row items-center justify-center gap-2">
            <Text className="font-sansSemi text-base text-textPrimary">Expenses {formatAmount(totalExpense)}</Text>
            <Ionicons name={expensesOpen ? 'chevron-up' : 'chevron-down'} size={14} color={colors.textMuted} />
          </Pressable>
          {expensesOpen ? (
            <View className="flex-row flex-wrap" style={{ gap: 10 }}>
              {expenseCategories.map((category) => (
                <View key={category.id} style={{ width: '31%' }}>
                  <CategoryCard
                    name={category.name}
                    icon={category.icon}
                    color={category.color}
                    spent={spendByCategory.get(category.id) ?? 0}
                    budget={resolvedBudgets.get(category.id)?.amount ?? null}
                    onPress={() => openCategoryDetail(category.id, 'expense')}
                  />
                </View>
              ))}
              {uncategorizedExpense ? (
                <View style={{ width: '31%' }}>
                  <CategoryCard
                    name={uncategorizedExpense.name}
                    icon={uncategorizedExpense.icon}
                    color={uncategorizedExpense.color}
                    spent={uncategorizedExpense.amount}
                    budget={null}
                    onPress={() => openCategoryDetail(UNCATEGORIZED_ID, 'expense')}
                  />
                </View>
              ) : null}
            </View>
          ) : null}

          <Pressable onPress={() => setIncomeOpen((v) => !v)} className="flex-row items-center justify-center gap-2">
            <Text className="font-sansSemi text-base text-textPrimary">Income {formatAmount(totalIncome)}</Text>
            <Ionicons name={incomeOpen ? 'chevron-up' : 'chevron-down'} size={14} color={colors.textMuted} />
          </Pressable>
          {incomeOpen ? (
            <View className="flex-row flex-wrap" style={{ gap: 10 }}>
              {incomeCategories.map((category) => (
                <View key={category.id} style={{ width: '31%' }}>
                  <CategoryCard
                    name={category.name}
                    icon={category.icon}
                    color={category.color}
                    spent={incomeByCategory.get(category.id) ?? 0}
                    budget={null}
                    onPress={() => openCategoryDetail(category.id, 'income')}
                  />
                </View>
              ))}
              {uncategorizedIncome ? (
                <View style={{ width: '31%' }}>
                  <CategoryCard
                    name={uncategorizedIncome.name}
                    icon={uncategorizedIncome.icon}
                    color={uncategorizedIncome.color}
                    spent={uncategorizedIncome.amount}
                    budget={null}
                    onPress={() => openCategoryDetail(UNCATEGORIZED_ID, 'income')}
                  />
                </View>
              ) : null}
            </View>
          ) : null}
        </ScrollView>
      )}

      <ViewTogglePill vizMode={vizMode} onToggle={() => setVizMode((v) => !v)} />

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
