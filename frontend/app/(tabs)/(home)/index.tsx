import { useCallback, useEffect, useMemo, useState } from 'react'
import { Pressable, Text, View, useWindowDimensions } from 'react-native'
import Animated, {
  Extrapolation,
  interpolate,
  runOnJS,
  useAnimatedReaction,
  useAnimatedRef,
  useAnimatedScrollHandler,
  useAnimatedStyle,
  useSharedValue,
} from 'react-native-reanimated'
import { Ionicons } from '@expo/vector-icons'
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context'
import { router, useFocusEffect } from 'expo-router'
import { setStatusBarStyle } from 'expo-status-bar'
import { colors } from '@/constants/theme'
import { useTransactionFeed } from '@/hooks/useTransactionFeed'
import { usePullToRefresh } from '@/hooks/usePullToRefresh'
import { useAccounts } from '@/hooks/useAccounts'
import { useBudgets } from '@/hooks/useBudgets'
import { useCategories } from '@/hooks/useCategories'
import { ErrorBanner } from '@/components/ui/ErrorBanner'
import { EmptyState } from '@/components/ui/EmptyState'
import { LoadingScreen } from '@/components/ui/LoadingScreen'
import { IconSwitch, type IconSwitchOption } from '@/components/ui/IconSwitch'
import { MonthCharts } from '@/components/visualizations/MonthCharts'
import { SpendingComparison } from '@/components/visualizations/SpendingComparison'
import { CategoryDetailSheet } from '@/components/visualizations/CategoryDetailSheet'
import { filterByMonth, shiftMonth } from '@/lib/transactions/filterByMonth'
import { useSelectedMonth } from '@/hooks/useSelectedMonth'
import { useHomeTabReselect } from '@/hooks/useHomeTabReselect'
import { useSelectedAccountFilter } from '@/hooks/useSelectedAccountFilter'
import { aggregateMonth } from '@/lib/transactions/aggregateMonth'
import { hasReimbursementSurplus } from '@/lib/transactions/totals'
import { UNCATEGORIZED_ID, computeDonutSegments } from '@/lib/transactions/visualizationData'
import type { DonutSegment } from '@/lib/transactions/visualizationData'
import { budgetStatus, monthElapsedFraction, resolveBudgetsForMonth } from '@/lib/budgets/budgetMath'
import { compareWithPreviousMonth } from '@/lib/budgets/monthComparison'
import { arrangeTiles, tileState } from '@/lib/home/categoryTiles'
import { MonthHeadline } from '@/components/home/MonthHeadline'
import { BudgetLine } from '@/components/home/BudgetLine'
import { COLLAPSED_BAR_HEIGHT, CollapsedMonthBar } from '@/components/home/CollapsedMonthBar'
import { TileRows, type GridTile } from '@/components/home/TileRows'
import { MonthHeader } from '@/components/home/MonthHeader'
import { useTransactionEditorActions } from '@/components/transactions/TransactionEditorProvider'
import type { YearMonth } from '@/lib/transactions/filterByMonth'

const VIEW_OPTIONS: Array<IconSwitchOption<'grid' | 'chart'>> = [
  { value: 'grid', icon: 'grid-outline', label: 'Summary' },
  { value: 'chart', icon: 'pie-chart-outline', label: 'Charts' },
]

/** The screen's side padding (px-5) and the grid's gutter. */
const SCREEN_PADDING = 20
const TILE_GAP = 10
const TILE_HEIGHT = 116
/** How far the sheet of tiles rides up over the bottom of the top section. */
const SHEET_OVERLAP = 24
const SHEET_RADIUS = 28
/** Cast upward, onto the top section: the sheet reads as lying over it rather than beside it. */
const SHEET_SHADOW = {
  shadowColor: '#000',
  shadowOffset: { width: 0, height: -4 },
  shadowOpacity: 0.06,
  shadowRadius: 16,
  elevation: 6,
}

export default function DashboardScreen() {
  const [month, setMonth] = useSelectedMonth()
  const [selectedAccountId, setSelectedAccountId] = useSelectedAccountFilter()
  const [expensesOpen, setExpensesOpen] = useState(true)
  const [incomeOpen, setIncomeOpen] = useState(true)
  const [view, setView] = useState<'grid' | 'chart'>('grid')
  const [detailState, setDetailState] = useState<{ segment: DonutSegment; mode: 'expense' | 'income' } | null>(null)

  const { feed, categoryById, isLoading, error, refresh } = useTransactionFeed()
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

  const { width: windowWidth, height: windowHeight } = useWindowDimensions()
  const insets = useSafeAreaInsets()
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

  // The top section scrolls away over the sheet. Once it has, the sheet comes to rest just under a
  // slim bar that keeps the month in view; the scroll snaps to fully open or fully collapsed, so the
  // page never sits half-way. Measured from the top section's own height, which changes with it.
  const scrollRef = useAnimatedRef<Animated.ScrollView>()
  const scrollY = useSharedValue(0)
  const [heroHeight, setHeroHeight] = useState(0)
  const [isCollapsed, setIsCollapsed] = useState(false)
  const collapseAt = Math.max(0, heroHeight - SHEET_OVERLAP - COLLAPSED_BAR_HEIGHT)
  // Home's tab tapped again: back to the Summary view, scrolled to the top with the month showing.
  useHomeTabReselect(() => {
    setView('grid')
    scrollRef.current?.scrollTo({ y: 0, animated: true })
  })
  const onScroll = useAnimatedScrollHandler((event) => {
    scrollY.value = event.contentOffset.y
  })
  const heroStyle = useAnimatedStyle(() => ({
    opacity: collapseAt > 0 ? interpolate(scrollY.value, [0, collapseAt], [1, 0.25], Extrapolation.CLAMP) : 1,
  }))
  const barStyle = useAnimatedStyle(() => ({
    opacity: collapseAt > 0 ? interpolate(scrollY.value, [collapseAt - 32, collapseAt], [0, 1], Extrapolation.CLAMP) : 0,
  }))
  useAnimatedReaction(
    () => collapseAt > 0 && scrollY.value >= collapseAt - 16,
    (collapsed, previous) => {
      if (collapsed !== previous) runOnJS(setIsCollapsed)(collapsed)
    },
    [collapseAt],
  )

  const hasNoAccounts = !accounts.isLoading && (accounts.data?.length ?? 0) === 0
  // The summary's top section is the brand teal right up under the clock, so the status bar turns
  // white while it shows — and back to dark on leaving, for every other screen's light background.
  const isOnTeal = view === 'grid' && !isLoading && !hasNoAccounts
  useFocusEffect(
    useCallback(() => {
      setStatusBarStyle(isOnTeal ? 'light' : 'dark')
      return () => setStatusBarStyle('dark')
    }, [isOnTeal]),
  )

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

  const headerTone = isOnTeal ? 'inverse' : 'default'
  // One header row: the month leads as the screen's heading, and the page's controls sit at the
  // right — the view switch (icons, as Investments switches its views), the account filter and the
  // pencil. Summary and Charts share it, so switching views leaves the header where it was.
  const topBar = (
    <MonthHeader
      tone={headerTone}
      month={month}
      onMonthChange={setMonth}
      accounts={accounts.data ?? []}
      selectedAccountId={selectedAccountId}
      onAccountChange={setSelectedAccountId}
      onWrite={openNewManual}
      extra={<IconSwitch tone={headerTone} options={VIEW_OPTIONS} value={view} onChange={setView} />}
    />
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
    <SafeAreaView style={{ flex: 1, backgroundColor: isOnTeal ? colors.primary : colors.background }} edges={['top']}>
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
            feed={feed}
            categoryById={categoryById}
            accounts={accounts.data ?? []}
          />
        </>
      ) : (
        <View style={{ flex: 1 }}>
          <Animated.ScrollView
            ref={scrollRef}
            onScroll={onScroll}
            scrollEventThrottle={16}
            contentInsetAdjustmentBehavior="automatic"
            refreshControl={refreshControl}
            snapToOffsets={collapseAt > 0 ? [0, collapseAt] : undefined}
            snapToEnd={false}
            // White under the sheet, so pulling past the bottom never shows the teal behind it.
            style={{ backgroundColor: colors.surface }}
          >
            {/* Teal above the top section too, so pulling down to refresh stays on the brand colour. */}
            <View style={{ position: 'absolute', top: -1000, left: 0, right: 0, height: 1000, backgroundColor: colors.primary }} />

            {/* The month on the brand colour: the header, the month, and its figures. The colour stays
                put while the contents fade, so the section never washes out as it collapses. */}
            <View onLayout={(e) => setHeroHeight(e.nativeEvent.layout.height)} style={{ backgroundColor: colors.primary }}>
              <Animated.View style={[{ paddingHorizontal: SCREEN_PADDING, paddingTop: 16, paddingBottom: SHEET_OVERLAP + 28, gap: 28 }, heroStyle]}>
                {topBar}
                {errorBanner}
                <MonthHeadline
                  totalExpense={totalExpense}
                  totalIncome={totalIncome}
                />
              </Animated.View>
            </View>

            {/* The sheet: the budget, then the categories. At least a screen tall, so the top section can
                always scroll fully away, however few tiles there are. */}
            <View
              style={[
                {
                  marginTop: -SHEET_OVERLAP,
                  minHeight: windowHeight - COLLAPSED_BAR_HEIGHT,
                  backgroundColor: colors.surface,
                  borderTopLeftRadius: SHEET_RADIUS,
                  borderTopRightRadius: SHEET_RADIUS,
                  paddingHorizontal: SCREEN_PADDING,
                  paddingTop: 24,
                  // Clears the floating tab bar, which the scroll view's automatic inset doesn't account
                  // for here, so the last row of tiles can scroll up above it (as the Charts pages do).
                  paddingBottom: insets.bottom + 88,
                  gap: 24,
                },
                SHEET_SHADOW,
              ]}
            >
              {/* How the month is pacing, the two ways: against the budget, and against last month. */}
              <View className="gap-4">
                <BudgetLine
                  budget={monthBudget}
                  onPress={() => router.push({ pathname: '/(tabs)/(home)/budgets', params: monthParams(month) })}
                />
                <View className="h-px bg-border" />
                <SpendingComparison month={month} comparison={comparison} isCurrentMonth={isCurrentMonth} />
              </View>

              {/* Each group of tiles under its own heading that folds it away — no totals, the top
                  section has them. */}
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
            </View>
          </Animated.ScrollView>

          <CollapsedMonthBar
            month={month}
            net={totalIncome - totalExpense}
            onPrevious={() => setMonth(shiftMonth(month, -1))}
            onNext={() => setMonth(shiftMonth(month, 1))}
            onExpand={() => scrollRef.current?.scrollTo({ y: 0, animated: true })}
            isInteractive={isCollapsed}
            style={barStyle}
          />
        </View>
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
