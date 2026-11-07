import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { ScrollView, Text, View } from 'react-native'
import { colors, shadow } from '@/constants/theme'
import { useTransactionFeed } from '@/hooks/useTransactionFeed'
import { usePullToRefresh } from '@/hooks/usePullToRefresh'
import type { FeedItem } from '@/lib/transactions/resolveFeed'
import { useAccounts } from '@/hooks/useAccounts'
import { useTransfers } from '@/hooks/useTransfers'
import { DayGroupedTransactions } from '@/components/transactions/DayGroupedTransactions'
import { CalendarCell } from '@/components/transactions/CalendarCell'
import {
  TransactionEditorErrorBanner,
  useTransactionEditorActions,
} from '@/components/transactions/TransactionEditorProvider'
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

/** Shared empty values, so a quiet day passes the same objects every render. */
const NO_SQUARES: DaySquare[] = []
const NO_HEAT: DayHeat = { tone: 'expense', intensity: 0 }

type TransactionFeedState = ReturnType<typeof useTransactionFeed>

interface MonthCalendarProps {
  month: YearMonth
  selectedAccountId: string | null
  /** The screen's top bar, scrolled with the calendar so the screen reads as one page. */
  header: ReactNode
}

function MonthCalendarContent({
  feedState,
  month,
  selectedAccountId,
  header,
}: MonthCalendarProps & { feedState: TransactionFeedState }) {
  const [suggestionsSheetOpen, setSuggestionsSheetOpen] = useState(false)
  // Only for the suggestion actions below. Everything the edit sheets can fail at reports through
  // the editor's own saveError.
  const [suggestionError, setSuggestionError] = useState<string | null>(null)
  const [selectedDate, setSelectedDate] = useState<string | null>(null)

  const scrollRef = useRef<ScrollView>(null)
  const sectionOffsets = useRef(new Map<string, number>())

  const { feed, categoryById, transferSuggestions, pendingTransferPreviews, isLoading, error, refresh } = feedState
  const refreshControl = usePullToRefresh(refresh)
  // Only the two callbacks a list needs, and both are stable — so none of the edit sheets' state
  // reaches this component, and opening one no longer re-renders the month behind it.
  const { openTransaction } = useTransactionEditorActions()
  const transferDismissals = useTransferDismissals()
  const accounts = useAccounts()
  const transfers = useTransfers()

  const accountFilteredFeed = useMemo(
    () => (selectedAccountId ? feed.filter((item) => item.accountId === selectedAccountId) : feed),
    [feed, selectedAccountId],
  )
  const monthFeed = useMemo(() => filterByMonth(accountFilteredFeed, month), [accountFilteredFeed, month])

  const filteredFeed = monthFeed

  useEffect(() => {
    const liveDates = new Set(filteredFeed.map((item) => item.date))
    for (const date of sectionOffsets.current.keys()) {
      if (!liveDates.has(date)) sectionOffsets.current.delete(date)
    }
  }, [filteredFeed])

  useEffect(() => {
    setSelectedDate(null)
  }, [month])

  const handleDatePress = useCallback((dateKey: string) => {
    setSelectedDate(dateKey)
    const y = sectionOffsets.current.get(dateKey)
    if (y == null) return
    scrollRef.current?.scrollTo({ y: Math.max(0, y - 8), animated: true })
  }, [])

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
    () => monthDayActivity(spendByDay, spendByDayCategory, (id) => (id ? categoryById.get(id)?.color : undefined) ?? colors.textMuted),
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
    (item: FeedItem) =>
      item.reimbursementCategoryId ? categoryById.get(item.reimbursementCategoryId)?.name ?? null : null,
    [categoryById],
  )
  // A ref write, so this never needs to change identity.
  const recordDayOffset = useCallback((date: string, y: number) => {
    sectionOffsets.current.set(date, y)
  }, [])

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
      <ScrollView
        ref={scrollRef}
        contentInsetAdjustmentBehavior="automatic"
        contentContainerStyle={{ paddingBottom: 40 }}
        refreshControl={refreshControl}
      >
        <View className="gap-5 px-5 pb-4 pt-4">
          {header}
          {error ? <ErrorBanner message="Something went wrong loading your transactions." /> : null}
          <TransactionEditorErrorBanner />
          {suggestionError ? <ErrorBanner message={suggestionError} onDismiss={() => setSuggestionError(null)} /> : null}
        </View>

        {/* Calendar — a card like the day cards below it, lifted by the same shadow so it holds its
            own on a white page. */}
        <View className="mx-5 mb-4 rounded-xl bg-surface p-3" style={shadow.sm}>
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
            <TransferSuggestionsBanner count={transferSuggestions.length + pendingTransferPreviews.length} onPress={() => setSuggestionsSheetOpen(true)} />
          </View>
        ) : null}

        {/* Transaction list grouped by date */}
        {filteredFeed.length === 0 ? (
          <View className="px-5 py-8">
            <Text className="text-center font-sans text-sm text-textMuted">No transactions this month</Text>
          </View>
        ) : (
          <DayGroupedTransactions
            items={filteredFeed}
            cardClassName="mx-5 mb-3 rounded-xl bg-surface px-4"
            categoryFor={categoryFor}
            reimbursementCategoryNameFor={reimbursementCategoryNameFor}
            onItemPress={openTransaction}
            onDayLayout={recordDayOffset}
          />
        )}
        <TabBarSpacer />
      </ScrollView>

      <TransferSuggestionsSheet
        visible={suggestionsSheetOpen}
        suggestions={transferSuggestions}
        pendingPreviews={pendingTransferPreviews}
        accounts={accounts.data ?? []}
        onClose={() => setSuggestionsSheetOpen(false)}
        onConfirm={handleConfirmSuggestion}
        onDismiss={handleDismissSuggestion}
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
