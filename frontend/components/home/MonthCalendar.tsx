import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Text, View } from 'react-native'
import Animated, { useAnimatedRef, useSharedValue } from 'react-native-reanimated'
import { useCollapseOnScroll } from '@/hooks/useCollapseOnScroll'
import { CALENDAR_BAR_HEIGHT, CollapsedCalendarBar } from '@/components/home/CollapsedCalendarBar'
import type { DayOffset } from '@/lib/transactions/dayStrip'
import { colors, shadow } from '@/constants/theme'
import { useTransactionFeed } from '@/hooks/useTransactionFeed'
import { usePullToRefresh } from '@/hooks/usePullToRefresh'
import type { FeedItem } from '@/lib/transactions/resolveFeed'
import { useAccounts } from '@/hooks/useAccounts'
import { useTransfers } from '@/hooks/useTransfers'
import { DayGroupedTransactions } from '@/components/transactions/DayGroupedTransactions'
import { CalendarCell } from '@/components/transactions/CalendarCell'
import { TransactionEditorErrorBanner, useTransactionEditorActions } from '@/components/transactions/TransactionEditorProvider'
import { TransferSuggestionsBanner, TransferSuggestionsSheet } from '@/components/transfers/TransferSuggestionsSheet'
import { useTransferDismissals } from '@/hooks/useTransferDismissals'
import { ErrorBanner } from '@/components/ui/ErrorBanner'
import { formatAmount } from '@/lib/format/money'
import { filterByMonth, type YearMonth } from '@/lib/transactions/filterByMonth'
import { aggregateMonth } from '@/lib/transactions/aggregateMonth'
import { toDateKey } from '@/lib/dates/dateKey'
import type { TransferSuggestion } from '@/hooks/useTransactionFeed'
import { monthDayActivity, type DayHeat, type DaySquare } from '@/lib/transactions/daySquares'
import { TabBarSpacer } from '@/components/navigation/FloatingTabs'
import { useSubcategories } from '@/hooks/useSubcategories'
import {
  activeFilterCount,
  applyCalendarFilter,
  latestMonth,
  matchingMonths,
  monthKey,
  type CalendarFilter,
} from '@/lib/transactions/calendarFilter'
import { CalendarFilterSheet } from '@/components/transactions/CalendarFilterSheet'
import { GroupsCard } from '@/components/groups/GroupsCard'
import { useTransactionGroups } from '@/hooks/useTransactionGroups'
import { hideActiveGroupMembers, summarizeGroup } from '@/lib/groups/groups'
import type { RowGroup } from '@/components/transactions/DayGroupedTransactions'

/** Shared empty values, so a quiet day passes the same objects every render. */
const NO_SQUARES: DaySquare[] = []
const NO_HEAT: DayHeat = { tone: 'expense', intensity: 0 }

type TransactionFeedState = ReturnType<typeof useTransactionFeed>

interface MonthCalendarProps {
  month: YearMonth
  selectedAccountId: string | null
  onMonthChange: (month: YearMonth) => void
  /**
   * The screen's top bar, scrolled with the calendar so the screen reads as one page. Given the
   * months the filter matches while one is on, for its month picker to limit itself to.
   */
  renderHeader: (availableMonths?: Set<string>) => ReactNode
  /** Narrows the month to matching rows — the list, the day shading and the totals alike. */
  filter: CalendarFilter
  onFilterChange: (filter: CalendarFilter) => void
  /** The filter sheet, opened from the header's filter button. */
  filterSheetOpen: boolean
  onFilterSheetClose: () => void
  /** The filter button, shown again on the bar the calendar collapses into. */
  filterButton: ReactNode
  /** Opens a group's sheet: from the Groups card, or a resolved row's group pill. */
  onOpenGroup: (groupId: string) => void
}

function MonthCalendarContent({
  feedState,
  month,
  selectedAccountId,
  onMonthChange,
  renderHeader,
  filter,
  onFilterChange,
  filterSheetOpen,
  onFilterSheetClose,
  filterButton,
  onOpenGroup,
}: MonthCalendarProps & { feedState: TransactionFeedState }) {
  const [suggestionsSheetOpen, setSuggestionsSheetOpen] = useState(false)
  // Only for the suggestion actions below. Everything the edit sheets can fail at reports through
  // the editor's own saveError.
  const [suggestionError, setSuggestionError] = useState<string | null>(null)
  const [selectedDate, setSelectedDate] = useState<string | null>(null)

  const scrollRef = useAnimatedRef<Animated.ScrollView>()
  const sectionOffsets = useRef(new Map<string, { y: number; height: number }>())
  // The same offsets, for the collapsed bar to follow the scroll by on the UI thread.
  const dayOffsets = useSharedValue<DayOffset[]>([])
  const viewportHeight = useSharedValue(0)
  const contentHeight = useSharedValue(0)
  const publishOffsets = useCallback(() => {
    dayOffsets.value = [...sectionOffsets.current].map(([date, { y, height }]) => ({ date, y, height }))
  }, [dayOffsets])

  // Scrolled past the calendar card, the grid gives way to a bar of the month's days pinned at the
  // top (CollapsedCalendarBar), as Home's top section gives way to its month bar. The card's bottom
  // edge, less the bar's height, is where that happens.
  const [calendarBottom, setCalendarBottom] = useState(0)
  const collapseAt = Math.max(0, calendarBottom - CALENDAR_BAR_HEIGHT)
  const { scrollY, onScroll, barStyle, isCollapsed } = useCollapseOnScroll(collapseAt)

  const { feed, categoryById, transferSuggestions, pendingTransferPreviews, isLoading, error, refresh } = feedState
  const refreshControl = usePullToRefresh(refresh)
  // Only the two callbacks a list needs, and both are stable — so none of the edit sheets' state
  // reaches this component, and opening one no longer re-renders the month behind it.
  const { openTransaction } = useTransactionEditorActions()
  const transferDismissals = useTransferDismissals()
  const accounts = useAccounts()
  const transfers = useTransfers()
  const subcategories = useSubcategories()

  const accountFilteredFeed = useMemo(
    () => (selectedAccountId ? feed.filter((item) => item.accountId === selectedAccountId) : feed),
    [feed, selectedAccountId],
  )
  const monthFeed = useMemo(() => filterByMonth(accountFilteredFeed, month), [accountFilteredFeed, month])

  // After the month, before aggregation: a filter narrows what the days and totals add up, but
  // aggregateMonth still decides what counts among the rows it's given.
  const filterMatches = useMemo(() => applyCalendarFilter(monthFeed, filter), [monthFeed, filter])
  // An active group's transactions sit in the Groups card until it's resolved, so they leave the
  // day cards — and with them the day totals and shading built from the same rows
  // (docs/transaction-groups.md §2). Same array back when nothing is hidden.
  const transactionGroups = useTransactionGroups()
  const filteredFeed = useMemo(
    () => hideActiveGroupMembers(filterMatches, transactionGroups.groups, transactionGroups.members),
    [filterMatches, transactionGroups.groups, transactionGroups.members],
  )
  // Whole-group figures, from the whole feed: a trip's card shows the trip, not this month's slice
  // of it or one account's.
  const feedById = useMemo(() => new Map(feed.map((item) => [item.id, item])), [feed])
  const activeGroupSummaries = useMemo(
    () =>
      transactionGroups.groups
        .filter((group) => group.resolvedAt === null)
        .map((group) => summarizeGroup(group, transactionGroups.members, feedById)),
    [transactionGroups.groups, transactionGroups.members, feedById],
  )
  // The pill on a resolved group's rows. Stable while groups don't change, so the list memo holds.
  const groupFor = useCallback(
    (item: FeedItem): RowGroup | null => {
      const groupId = transactionGroups.groupIdByItem.get(item.id)
      const group = groupId ? transactionGroups.groupById.get(groupId) : undefined
      return group ? { id: group.id, name: group.name, color: group.color } : null
    },
    [transactionGroups.groupIdByItem, transactionGroups.groupById],
  )
  const isFiltered = activeFilterCount(filter) > 0
  // The filter isn't tied to a month: these are the months worth stepping to with it on.
  const availableMonths = useMemo(
    () => (isFiltered ? matchingMonths(accountFilteredFeed, filter) : undefined),
    [isFiltered, accountFilteredFeed, filter],
  )

  // Applying a filter the month on screen has nothing for lands on the latest month that does,
  // rather than on an empty calendar. One that matches nowhere stays put, and says so below.
  const applyFilter = useCallback(
    (next: CalendarFilter) => {
      onFilterChange(next)
      if (activeFilterCount(next) === 0) return
      const months = matchingMonths(accountFilteredFeed, next)
      if (months.has(monthKey(month))) return
      const latest = latestMonth(months)
      if (latest) onMonthChange(latest)
    },
    [onFilterChange, onMonthChange, accountFilteredFeed, month],
  )

  useEffect(() => {
    const liveDates = new Set(filteredFeed.map((item) => item.date))
    for (const date of sectionOffsets.current.keys()) {
      if (!liveDates.has(date)) sectionOffsets.current.delete(date)
    }
    publishOffsets()
  }, [filteredFeed, publishOffsets])

  useEffect(() => {
    setSelectedDate(null)
  }, [month])

  const handleDatePress = useCallback(
    (dateKey: string) => {
      setSelectedDate(dateKey)
      const y = sectionOffsets.current.get(dateKey)?.y
      if (y == null) return
      // Below the bar, which is showing by the time the list is reached.
      scrollRef.current?.scrollTo({ y: Math.max(0, y - CALENDAR_BAR_HEIGHT - 8), animated: true })
    },
    [scrollRef],
  )

  const expandCalendar = useCallback(() => scrollRef.current?.scrollTo({ y: 0, animated: true }), [scrollRef])

  const daysInMonth = new Date(month.year, month.month, 0).getDate()
  const firstWeekday = new Date(month.year, month.month - 1, 1).getDay()
  const todayKey = toDateKey(new Date())

  const calendarDays = useMemo(() => {
    const days: Array<{ day: number; dateKey: string } | null> = []
    for (let i = 0; i < firstWeekday; i++) days.push(null)
    for (let day = 1; day <= daysInMonth; day++) {
      const dateKey = `${month.year}-${String(month.month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
      days.push({ day, dateKey })
    }
    return days
  }, [month, daysInMonth, firstWeekday])

  const { spendByDay, spendByDayCategory, totalExpense, totalIncome } = useMemo(
    () => aggregateMonth(filteredFeed),
    [filteredFeed],
  )

  // Per-day category mix and heat shade. Built once per month, so each memoized cell gets the
  // same objects back until the data changes.
  const dayActivity = useMemo(
    () =>
      monthDayActivity(
        spendByDay,
        spendByDayCategory,
        (id) => (id ? categoryById.get(id)?.color : undefined) ?? colors.textMuted,
      ),
    [spendByDay, spendByDayCategory, categoryById],
  )

  // Hoisted out of the JSX so DayGroupedTransactions' memo actually holds. Inline arrows here gave
  // it three fresh props on every render of this screen — including the ten a single sheet round
  // trip produces — which re-rendered the entire month's rows behind the sheet.
  const categoryFor = useCallback(
    (item: FeedItem) => {
      const category = item.categoryId ? categoryById.get(item.categoryId) : undefined
      return {
        name: category?.name ?? 'Uncategorized',
        color: category?.color ?? colors.textMuted,
        icon: category?.icon ?? null,
      }
    },
    [categoryById],
  )
  const reimbursementCategoryNameFor = useCallback(
    (item: FeedItem) => (item.reimbursementCategoryId ? (categoryById.get(item.reimbursementCategoryId)?.name ?? null) : null),
    [categoryById],
  )
  // A ref write and a shared-value write, so this never needs to change identity.
  const recordDayOffset = useCallback(
    (date: string, y: number, height: number) => {
      sectionOffsets.current.set(date, { y, height })
      publishOffsets()
    },
    [publishOffsets],
  )

  const monthDays = useMemo(
    () => calendarDays.filter((cell): cell is { day: number; dateKey: string } => cell != null),
    [calendarDays],
  )
  const datesWithRows = useMemo(() => new Set(filteredFeed.map((item) => item.date)), [filteredFeed])

  // Suggestion legs are always Plaid-sourced (detection eligibility), so the plaid id
  // fields are correct on both sides. Confirming creates a normal manual-source transfer —
  // the user vouched for it, exactly as if they'd built it in the TransferSheet.
  async function handleConfirmSuggestion(suggestion: TransferSuggestion) {
    try {
      await transfers.create({
        kind: suggestion.kind,
        expensePlaidTransactionId: suggestion.expense.id,
        expenseManualTransactionId: null,
        incomePlaidTransactionId: suggestion.income.id,
        incomeManualTransactionId: null,
        amount: suggestion.amount.toFixed(2),
        note: null,
      })
    } catch (err) {
      setSuggestionError(err instanceof Error ? err.message : 'Could not link this transfer. Try again.')
    }
  }

  async function handleDismissSuggestion(suggestion: TransferSuggestion) {
    try {
      await transferDismissals.create({ expensePlaidTransactionId: suggestion.expense.id })
    } catch (err) {
      setSuggestionError(err instanceof Error ? err.message : 'Could not dismiss this suggestion. Try again.')
    }
  }

  if (isLoading) return null

  return (
    <>
      {/* Its own box, so the bar's top edge is this view's, under the safe area — not the safe area
          view's, whose padding it would otherwise sit inside. */}
      <View style={{ flex: 1 }}>
        <Animated.ScrollView
          ref={scrollRef}
          onScroll={onScroll}
          scrollEventThrottle={16}
          onLayout={(event) => {
            viewportHeight.value = event.nativeEvent.layout.height
          }}
          onContentSizeChange={(_, height) => {
            contentHeight.value = height
          }}
          contentInsetAdjustmentBehavior="automatic"
          contentContainerStyle={{ paddingBottom: 40 }}
          refreshControl={refreshControl}
          // Settles fully open or fully collapsed near the top, as Home does; free below that.
          snapToOffsets={collapseAt > 0 ? [0, collapseAt] : undefined}
          snapToEnd={false}
        >
          <View className="gap-5 px-5 pb-4 pt-4">
            {renderHeader(availableMonths)}
            {error ? <ErrorBanner message="Something went wrong loading your transactions." /> : null}
            <TransactionEditorErrorBanner />
            {suggestionError ? <ErrorBanner message={suggestionError} onDismiss={() => setSuggestionError(null)} /> : null}
          </View>

          {/* Calendar — a card like the day cards below it, lifted by the same shadow so it holds its
            own on a white page. */}
          <View
            className="mx-5 mb-4 rounded-xl bg-surface p-3"
            style={shadow.sm}
            onLayout={(event) => setCalendarBottom(event.nativeEvent.layout.y + event.nativeEvent.layout.height)}
          >
            <View className="mb-1 flex-row">
              {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((day) => (
                <Text key={day} className="text-center font-sansMed text-xs text-textMuted" style={{ width: '14.28%' }}>
                  {day}
                </Text>
              ))}
            </View>
            <View className="flex-row flex-wrap">
              {calendarDays.map((cell, index) =>
                cell ? (
                  <View key={cell.dateKey} style={{ width: '14.28%' }}>
                    <CalendarCell
                      day={cell.day}
                      netAmount={spendByDay.get(cell.dateKey)?.net ?? null}
                      hasReimbursement={spendByDay.get(cell.dateKey)?.hasReimbursement ?? false}
                      isToday={cell.dateKey === todayKey}
                      isSelected={cell.dateKey === selectedDate}
                      dateKey={cell.dateKey}
                      onPress={handleDatePress}
                      squares={dayActivity.get(cell.dateKey)?.squares ?? NO_SQUARES}
                      heat={dayActivity.get(cell.dateKey)?.heat ?? NO_HEAT}
                    />
                  </View>
                ) : (
                  <View key={`empty-${index}`} style={{ width: '14.28%' }} />
                ),
              )}
            </View>

            <View className="mt-3 flex-row justify-between border-t px-2 pt-3" style={{ borderColor: colors.border }}>
              <View className="items-start">
                <Text className="font-sansMed text-xs text-textPrimary">Income</Text>
                <Text className="font-display text-md text-income">{formatAmount(totalIncome)}</Text>
              </View>
              <View className="items-center">
                <Text className="font-sansMed text-xs text-textPrimary">Expenses</Text>
                <Text className="font-display text-md text-expense">{formatAmount(totalExpense)}</Text>
              </View>
              <View className="items-end">
                <Text className="font-sansMed text-xs text-textPrimary">Balance</Text>
                <Text className="font-display text-md text-textPrimary">{formatAmount(totalIncome - totalExpense)}</Text>
              </View>
            </View>
          </View>

          {transferSuggestions.length + pendingTransferPreviews.length > 0 ? (
            <View className="mx-5 mb-4">
              <TransferSuggestionsBanner
                count={transferSuggestions.length + pendingTransferPreviews.length}
                onPress={() => setSuggestionsSheetOpen(true)}
              />
            </View>
          ) : null}

          <GroupsCard summaries={activeGroupSummaries} onOpen={onOpenGroup} />

          {/* Transaction list grouped by date */}
          {filteredFeed.length === 0 ? (
            <View className="px-5 py-8">
              <Text className="text-center font-sans text-sm text-textSecondary">
                {!isFiltered
                  ? 'No transactions this month'
                  : availableMonths?.size
                    ? 'No matching transactions this month'
                    : 'No transactions match these filters'}
              </Text>
            </View>
          ) : (
            <DayGroupedTransactions
              items={filteredFeed}
              cardClassName="mx-5 mb-3 rounded-xl bg-surface px-4"
              categoryFor={categoryFor}
              reimbursementCategoryNameFor={reimbursementCategoryNameFor}
              onItemPress={openTransaction}
              onDayLayout={recordDayOffset}
              groupFor={groupFor}
              onGroupPress={onOpenGroup}
            />
          )}
          <TabBarSpacer />
        </Animated.ScrollView>

        <CollapsedCalendarBar
          month={month}
          days={monthDays}
          dayActivity={dayActivity}
          datesWithRows={datesWithRows}
          todayKey={todayKey}
          scrollY={scrollY}
          dayOffsets={dayOffsets}
          viewportHeight={viewportHeight}
          contentHeight={contentHeight}
          collapseAt={collapseAt}
          onDayPress={handleDatePress}
          onExpand={expandCalendar}
          filterButton={filterButton}
          isInteractive={isCollapsed}
          style={barStyle}
        />
      </View>

      <TransferSuggestionsSheet
        visible={suggestionsSheetOpen}
        suggestions={transferSuggestions}
        pendingPreviews={pendingTransferPreviews}
        accounts={accounts.data ?? []}
        onClose={() => setSuggestionsSheetOpen(false)}
        onConfirm={handleConfirmSuggestion}
        onDismiss={handleDismissSuggestion}
      />

      <CalendarFilterSheet
        visible={filterSheetOpen}
        onClose={onFilterSheetClose}
        filter={filter}
        onApply={applyFilter}
        feed={accountFilteredFeed}
        categoryById={categoryById}
        subcategories={subcategories.data ?? []}
      />
    </>
  )
}

/**
 * Home's calendar view: the month as days, each shaded by what it spent, over the day-by-day list a
 * tapped day scrolls to.
 *
 * Thin on purpose. It owns the feed query and nothing else, so the provider's state changes stop
 * here: the content element below is created by this render and is unchanged by reference when the
 * provider re-renders for a sheet, which is what lets React skip the whole calendar.
 */
export function MonthCalendar(props: MonthCalendarProps) {
  const feedState = useTransactionFeed()
  // The editor is mounted once in the tabs layout; see AuthedShell there for why it cannot live
  // inside a sheet or a screen.
  return <MonthCalendarContent feedState={feedState} {...props} />
}
