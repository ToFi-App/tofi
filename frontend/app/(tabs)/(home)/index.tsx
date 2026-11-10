import { useCallback, useMemo, useState } from 'react'
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
import { colors, heroGradient, pageBackdrop } from '@/constants/theme'
import { useTransactionFeed } from '@/hooks/useTransactionFeed'
import { usePullToRefresh } from '@/hooks/usePullToRefresh'
import { useAccounts } from '@/hooks/useAccounts'
import { useCategories } from '@/hooks/useCategories'
import { ErrorBanner } from '@/components/ui/ErrorBanner'
import { EmptyState } from '@/components/ui/EmptyState'
import { LoadingScreen } from '@/components/ui/LoadingScreen'
import type { IconSwitchOption } from '@/components/ui/IconSwitch'
import { MonthCharts } from '@/components/visualizations/MonthCharts'
import { SpendingComparison } from '@/components/visualizations/SpendingComparison'
import { CategoryDetailSheet } from '@/components/visualizations/CategoryDetailSheet'
import { filterByMonth, shiftMonth } from '@/lib/transactions/filterByMonth'
import { useSelectedMonth } from '@/hooks/useSelectedMonth'
import { useHomeTabReselect } from '@/hooks/useHomeTabReselect'
import { useSelectedAccountFilter } from '@/hooks/useSelectedAccountFilter'
import { useMonthCategories } from '@/hooks/useMonthCategories'
import { aggregateMonth } from '@/lib/transactions/aggregateMonth'
import { budgetStatus } from '@/lib/budgets/budgetMath'
import { compareWithPreviousMonth } from '@/lib/budgets/monthComparison'
import { MonthHeadline } from '@/components/home/MonthHeadline'
import { BudgetLine } from '@/components/home/BudgetLine'
import { SavingsRate } from '@/components/home/SavingsRate'
import { COLLAPSED_BAR_HEIGHT, CollapsedMonthBar } from '@/components/home/CollapsedMonthBar'
import { CategorySummaryCard } from '@/components/home/CategorySummaryCard'
import { HomeHeader } from '@/components/home/HomeHeader'
import { LinearGradient } from 'expo-linear-gradient'
import { HeroBackground } from '@/components/home/HeroBackground'
import { GlassSwitch } from '@/components/ui/GlassSwitch'
import { HeroSurfaceContext } from '@/components/ui/HeroGlass'
import { PageBackdrop } from '@/components/ui/PageBackdrop'
import { SwipeViews } from '@/components/ui/SwipeViews'
import { useTransactionEditorActions } from '@/components/transactions/TransactionEditorProvider'
import type { YearMonth } from '@/lib/transactions/filterByMonth'

const VIEW_OPTIONS: Array<IconSwitchOption<'grid' | 'chart'>> = [
  { value: 'grid', icon: 'grid-outline', label: 'Summary' },
  { value: 'chart', icon: 'pie-chart-outline', label: 'Charts' },
]

/** The screen's side padding (px-5). */
const SCREEN_PADDING = 20
/** How far the sheet of tiles rides up over the bottom of the top section. */
const SHEET_OVERLAP = 24
const SHEET_RADIUS = 28
/** Cast upward, onto the top section: the sheet reads as lying over it rather than beside it. */
const SHEET_SHADOW = {
  shadowColor: '#000',
  shadowOffset: { width: 0, height: -6 },
  shadowOpacity: 0.1,
  shadowRadius: 18,
  elevation: 6,
}

export default function DashboardScreen() {
  const [month, setMonth] = useSelectedMonth()
  const [selectedAccountId, setSelectedAccountId] = useSelectedAccountFilter()
  const [view, setView] = useState<'grid' | 'chart'>('grid')
  // Which Charts page to open on: the Summary's view switch opens by-category, its Cash flow button
  // the Cash Flow page.
  const [chartPage, setChartPage] = useState(0)

  const { feed, categoryById, isLoading, error, refresh } = useTransactionFeed()
  const refreshControl = usePullToRefresh(refresh)
  const accounts = useAccounts()
  const categories = useCategories()
  const { openNewManual } = useTransactionEditorActions()

  const {
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
    detail,
  } = useMonthCategories()

  const { height: windowHeight } = useWindowDimensions()
  const insets = useSafeAreaInsets()

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
  // Last month's In and Out, for the savings rate's comparison when its tile is held.
  const previousTotals = useMemo(() => {
    const { totalIncome: income, totalExpense: expense } = aggregateMonth(
      filterByMonth(accountFilteredFeed, shiftMonth(month, -1)),
    )
    return { income, expense }
  }, [accountFilteredFeed, month])
  // This month against last as running totals — every category, budgeted or not — for the chart view.
  const comparison = useMemo(() => compareWithPreviousMonth(accountFilteredFeed, month), [accountFilteredFeed, month])

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
    setChartPage(0)
    scrollRef.current?.scrollTo({ y: 0, animated: true })
  })
  const onScroll = useAnimatedScrollHandler((event) => {
    scrollY.value = event.contentOffset.y
  })
  const heroStyle = useAnimatedStyle(() => ({
    opacity: collapseAt > 0 ? interpolate(scrollY.value, [0, collapseAt], [1, 0.25], Extrapolation.CLAMP) : 1,
  }))
  // The sheet's top corners square off as it comes to rest under the collapsed bar: rounded, it reads
  // as a sheet lifted over the top section; once that section is gone, under a straight bar, the round
  // corners would only leave notches of colour at the bar's ends.
  const sheetCornerStyle = useAnimatedStyle(() => {
    const radius =
      collapseAt > 0
        ? interpolate(scrollY.value, [collapseAt - 40, collapseAt], [SHEET_RADIUS, 0], Extrapolation.CLAMP)
        : SHEET_RADIUS
    return { borderTopLeftRadius: radius, borderTopRightRadius: radius }
  })
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
  // The Summary's top section runs up under the clock, so the status bar takes its colour — and its
  // text follows the section's own ink: white over the deep teal, dark if the section is ever light.
  // Back to dark on leaving, for every other screen's light background.
  const isOnHero = view === 'grid' && !isLoading && !hasNoAccounts
  useFocusEffect(
    useCallback(() => {
      setStatusBarStyle(isOnHero && heroGradient.ink === colors.textInverse ? 'light' : 'dark')
      return () => setStatusBarStyle('dark')
    }, [isOnHero]),
  )

  if (isLoading) return <LoadingScreen />

  if (hasNoAccounts) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }} edges={['top']}>
        <EmptyState message="Link an account in Settings to see your spending here." />
      </SafeAreaView>
    )
  }

  const monthParams = (target: YearMonth) => ({ year: String(target.year), month: String(target.month) })

  function changeView(next: 'grid' | 'chart', page = 0) {
    setChartPage(page)
    setView(next)
  }

  // The Summary/Charts switch, at the left of the header both views share — so the way between them,
  // and the month, filter and pen beside it, stay in the same place whichever view is showing.
  const viewSwitch = <GlassSwitch options={VIEW_OPTIONS} value={view} onChange={(next) => changeView(next)} />
  const summaryHeader = (
    <HomeHeader
      month={month}
      onMonthChange={setMonth}
      accounts={accounts.data ?? []}
      selectedAccountId={selectedAccountId}
      onAccountChange={setSelectedAccountId}
      onWrite={openNewManual}
      leading={viewSwitch}
    />
  )

  // Save errors are reported by the edit sheets themselves (CategoryDetailSheet owns the editor),
  // so this screen only surfaces its own data-loading failure.
  const errorBanner = error ? <ErrorBanner message="Something went wrong loading your data." /> : null

  // The gradient's first stop, flat: behind the status bar, above the top section when pulled down
  // to refresh, and on the collapsed bar. The gradient runs straight down from it, so the three
  // meet the section's top edge without a seam.
  const heroTop = heroGradient.stops[0]

  return (
    // Behind the status bar: the top section's colour on the Summary, the page backdrop's top on Charts.
    <SafeAreaView
      style={{ flex: 1, backgroundColor: isOnHero ? heroTop : view === 'chart' ? pageBackdrop.stops[0] : colors.background }}
      edges={['top']}
    >
      {/* The status-bar band on the Summary, drawn by the same gradient renderer as the top section
          and in its exact top colour, rather than as the safe area's flat fill — so the two meet as one
          surface with no visible line where the safe area ends. */}
      {isOnHero ? (
        <LinearGradient
          colors={[heroTop, heroTop]}
          pointerEvents="none"
          style={{ position: 'absolute', top: 0, left: 0, right: 0, height: insets.top }}
        />
      ) : null}
      {view === 'chart' ? (
        // On the app's page backdrop — the same faint near-white the Summary's sheet uses — with no sheet
        // and no mint band. Only the header is shared, in the same place, so the way around stays the same.
        <View style={{ flex: 1 }}>
          <PageBackdrop />
          <View style={{ paddingHorizontal: SCREEN_PADDING, paddingTop: 16, paddingBottom: 16, gap: 12 }}>
            <HeroSurfaceContext.Provider value="plain">{summaryHeader}</HeroSurfaceContext.Provider>
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
            onSegmentPress={openSegment}
            feed={feed}
            categoryById={categoryById}
            accounts={accounts.data ?? []}
            initialPage={chartPage}
            onSwipePastStart={() => changeView('grid')}
          />
        </View>
      ) : (
        <SwipeViews onSwipeLeft={() => changeView('chart')}>
          <Animated.ScrollView
            ref={scrollRef}
            onScroll={onScroll}
            scrollEventThrottle={16}
            contentInsetAdjustmentBehavior="automatic"
            refreshControl={refreshControl}
            snapToOffsets={collapseAt > 0 ? [0, collapseAt] : undefined}
            snapToEnd={false}
            // The sheet's colour under it, so pulling past the bottom never shows the mint behind it.
            style={{ backgroundColor: pageBackdrop.sheet.stops[pageBackdrop.sheet.stops.length - 1] }}
          >
            {/* The gradient's top colour above the section too, so pulling down to refresh stays on it. */}
            <View style={{ position: 'absolute', top: -1000, left: 0, right: 0, height: 1000, backgroundColor: heroTop }} />

            {/* The month on the mint gradient: the header, then its one figure. The gradient scrolls
                with the section and stays at full strength while only the contents fade, so the section
                never washes out as it collapses. */}
            <View onLayout={(e) => setHeroHeight(e.nativeEvent.layout.height)}>
              <HeroBackground />
              <Animated.View
                style={[
                  { paddingHorizontal: SCREEN_PADDING, paddingTop: 16, paddingBottom: SHEET_OVERLAP + 32, gap: 28 },
                  heroStyle,
                ]}
              >
                {summaryHeader}
                {errorBanner}
                <MonthHeadline totalExpense={totalExpense} totalIncome={totalIncome} />
              </Animated.View>
            </View>

            {/* The sheet: a soft mint backdrop, each group on a frosted card floating on it. At least a
                screen tall, so the top section can always scroll fully away, however few tiles there
                are. */}
            <Animated.View
              style={[
                {
                  marginTop: -SHEET_OVERLAP,
                  minHeight: windowHeight - COLLAPSED_BAR_HEIGHT,
                  paddingHorizontal: SCREEN_PADDING,
                  paddingTop: 20,
                  // Clears the floating tab bar, which the scroll view's automatic inset doesn't account
                  // for here, so the last row of tiles can scroll up above it (as the Charts pages do).
                  paddingBottom: insets.bottom + 88,
                  gap: 24,
                },
                SHEET_SHADOW,
                sheetCornerStyle,
              ]}
            >
              {/* The backdrop; it carries the sheet's top corners itself (squaring off with them as the
                  top section collapses), since clipping the sheet would clip its shadow too. */}
              <PageBackdrop variant="sheet" rim cornerStyle={sheetCornerStyle} />
              {/* How the month is going: against the budget across the top, then against last month and
                  how much was kept — with the way into where the money went, between accounts too, above. */}
              <View className="gap-3">
                <View className="flex-row items-center justify-between">
                  <Text className="font-sansSemi text-md text-textPrimary" accessibilityRole="header">
                    Overview
                  </Text>
                  <PillButton label="Cash flow" onPress={() => changeView('chart', 1)} />
                </View>
                <BudgetLine
                  budget={monthBudget}
                  onPress={() => router.push({ pathname: '/(tabs)/(home)/budgets', params: monthParams(month) })}
                />
                {/* Two tiles side by side, stretched to one height: how much of what came in was kept,
                    and spending against last month. */}
                <View className="flex-row gap-3">
                  <SavingsRate income={totalIncome} expense={totalExpense} previous={previousTotals} />
                  <SpendingComparison month={month} comparison={comparison} />
                </View>
              </View>

              {/* Where the money went and came from, each a preview of its biggest categories; the card
                  opens the full page of tiles. */}
              {expenseTiles.length > 0 ? (
                <CategorySummaryCard
                  title="Expenses"
                  total={totalExpense}
                  tiles={expenseTiles}
                  onPress={() => router.push({ pathname: '/(tabs)/(home)/categories', params: { mode: 'expense' } })}
                />
              ) : null}
              {incomeTiles.length > 0 ? (
                <CategorySummaryCard
                  title="Income"
                  total={totalIncome}
                  tiles={incomeTiles}
                  onPress={() => router.push({ pathname: '/(tabs)/(home)/categories', params: { mode: 'income' } })}
                />
              ) : null}
            </Animated.View>
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
        </SwipeViews>
      )}

      <CategoryDetailSheet
        {...detail}
        feed={feed}
      />
    </SafeAreaView>
  )
}

/** A small frosted pill with a chevron, leading off the sheet to another page — the cards' material. */
function PillButton({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} accessibilityRole="button" hitSlop={6}>
      {({ pressed }) => (
        <View
          className="flex-row items-center gap-0.5 rounded-full pl-3 pr-2"
          style={{
            height: 30,
            // The cards' material: frosted on the tinted sheet, solid white with a grey rim on a white one.
            backgroundColor: pageBackdrop.frostedCards ? colors.frostCard : colors.surface,
            borderWidth: 1,
            borderColor: pageBackdrop.frostedCards ? colors.frostCardBorder : colors.borderCard,
            opacity: pressed ? 0.7 : 1,
          }}
        >
          <Text className="font-sansMed text-sm text-textPrimary">{label}</Text>
          <Ionicons name="chevron-forward" size={14} color={colors.textPrimary} />
        </View>
      )}
    </Pressable>
  )
}
