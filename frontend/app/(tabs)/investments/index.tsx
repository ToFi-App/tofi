import { useEffect, useMemo, useState } from 'react'
import { ActivityIndicator, Modal, Pressable, ScrollView, Text, View } from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import { SafeAreaView } from 'react-native-safe-area-context'
import { router } from 'expo-router'
import { colors, spacing } from '@/constants/theme'
import { useTransactionFeed } from '@/hooks/useTransactionFeed'
import { usePullToRefresh } from '@/hooks/usePullToRefresh'
import { useAmountsMasked } from '@/hooks/useAmountsMasked'
import { useHoldings } from '@/hooks/useHoldings'
import { useInvestmentScope } from '@/hooks/useInvestmentScope'
import { useInvestmentAccountFilter } from '@/hooks/useInvestmentAccountFilter'
import { useTrendViewport } from '@/hooks/useTrendViewport'
import { HoldingsHeatMap } from '@/components/accounts/HoldingsHeatMap'
import { HoldingRows, type HoldingChange } from '@/components/accounts/HoldingRows'
import { accountFallbackIcon } from '@/components/accounts/AccountRow'
import { AccountList, AssetAllocation, type AccountSummaryRow } from '@/components/investments/PortfolioSummary'
import { InvestmentHistoryChart } from '@/components/accounts/InvestmentHistoryChart'
import { AccountsFilterDropdown } from '@/components/ui/AccountsFilterDropdown'
import { EmptyState } from '@/components/ui/EmptyState'
import { Pill } from '@/components/ui/RangePills'
import { DayGroupHeader } from '@/components/transactions/DayGroupHeader'
import { TransactionRow } from '@/components/transactions/TransactionRow'
import {
  TransactionEditorErrorBanner,
  useTransactionEditorActions,
} from '@/components/transactions/TransactionEditorProvider'
import { formatGainPct, holdingsPricedAsOf, performanceColor } from '@/lib/accounts/holdings'
import { investmentHeadlineGain, netPrincipal } from '@/lib/accounts/principal'
import { bucketOf, type Granularity, type TrendRange } from '@/lib/accounts/netWorthHistory'
import { dayOf, viewportBuckets, visiblePoints } from '@/lib/accounts/trendViewport'
import { cashFlowMarkers, fillCalendarDays, rangeGain, windowReading } from '@/lib/investments/accountHistory'
import { holdingRangeChange } from '@/lib/investments/portfolio'
import { markerRadius } from '@/lib/charts/markers'
import { formatRelativeIsoTime } from '@/lib/format/date'
import { formatAmount, formatMaskableAmount } from '@/lib/format/money'
import { groupByDay } from '@/lib/transactions/groupByDay'
import type { FeedItem } from '@/lib/transactions/resolveFeed'
import type { Category, Holding } from '@/types/domain'

/** How often the "last refreshed" label re-reads the clock. */
const FRESHNESS_TICK_MS = 30 * 1000
// Capped by day, not by row: a partially-shown day would print an IN/OUT total covering rows the
// user can't see.
const TRANSFER_DAY_LIMIT = 12
const DEFAULT_RANGE: TrendRange = '1W'
const GRANULARITY: Granularity = 'day'

/** Trend is the value over time; breakdown is what it's made of today, as the holdings map. */
type InvestmentView = 'trend' | 'breakdown'

/**
 * How the investments are doing: the portfolio line, which holdings moved it, and what's held.
 *
 * One screen for every account and for each one alone. Opened from the tab bar it shows whatever
 * was last picked; Net Worth's investment rows set the picker to their account before switching
 * here, so tapping an account lands straight on its performance with nothing in between.
 */
export default function InvestmentsScreen() {
  const [filterId, setFilterId] = useInvestmentAccountFilter()
  const { portfolio, selectedAccount, shownAccounts, holdings, holdingsLoading, holdingsFailed, investmentHistory } =
    useInvestmentScope(filterId)
  const { investmentAccounts, holdingsByAccount, histories } = portfolio
  const { feed, categoryById, refresh } = useTransactionFeed()
  const refreshControl = usePullToRefresh(refresh)
  const { isMasked } = useAmountsMasked()
  const shownIds = useMemo(() => new Set(shownAccounts.map((a) => a.account_id)), [shownAccounts])

  // The selected account's own query, for its loading and error states (relink needed); its data is
  // the same cache entry useLiveInvestments reads.
  const singleHoldings = useHoldings(selectedAccount ? { itemId: selectedAccount.itemId, accountId: selectedAccount.account_id } : null)
  const needsRelink = singleHoldings.error?.message.includes('ADDITIONAL_CONSENT_REQUIRED') ?? false

  const hasHoldings = holdings.length > 0

  const balance = shownAccounts.reduce((sum, a) => sum + (a.balances?.current ?? 0), 0)
  const items = useMemo(() => feed.filter((item) => item.accountId != null && shownIds.has(item.accountId)), [feed, shownIds])
  const principal = useMemo(() => netPrincipal(items), [items])
  const totalGain = useMemo(() => investmentHeadlineGain(balance, principal, holdings), [balance, principal, holdings])

  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), FRESHNESS_TICK_MS)
    return () => clearInterval(timer)
  }, [])
  const asOfLabel = formatRelativeIsoTime(holdingsPricedAsOf(holdings), now)
  const [showRefreshInfo, setShowRefreshInfo] = useState(false)

  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [view, setView] = useState<InvestmentView>('trend')
  const isTrend = view === 'trend'
  useEffect(() => {
    setSelectedId(null)
  }, [filterId])
  // A holding's own page, pushed on this tab's stack: it slides in, and swipes back.
  const openHolding = (securityId: string) =>
    router.push({ pathname: '/(tabs)/investments/holding', params: { securityId, accountId: selectedAccount?.account_id ?? '' } })

  const history = investmentHistory.history
  const trendPoints = useMemo(
    () => fillCalendarDays(history?.points ?? []).map((p) => ({ ...p, start: p.date, bucket: bucketOf(p.date, GRANULARITY) })),
    [history],
  )
  const { activeRange, chooseRange, viewport, handleZoomStart, handleZoomEnd, handleZoom, selectedIndex, handleSelect } =
    useTrendViewport({
      earliestDay: dayOf(investmentHistory.earliest),
      todayDay: dayOf(investmentHistory.today),
      yearStartDay: dayOf(`${investmentHistory.today.slice(0, 4)}-01-01`),
      defaultRange: DEFAULT_RANGE,
    })
  const visible = useMemo(() => visiblePoints(trendPoints, GRANULARITY, viewport), [trendPoints, viewport])
  const slots = useMemo(() => viewportBuckets(viewport, GRANULARITY), [viewport])
  const linePoints = useMemo(() => visible.map((p) => ({ value: p.value })), [visible])
  // Deposits and withdrawals as dots on the line, read from each account's own activity. Across
  // several accounts each dot names its account — "to Individual", "from ROTH IRA" — so a transfer
  // between two of them reads as the pair it is rather than two unexplained dots.
  const flowMarkers = useMemo(() => {
    const dates = visible.map((p) => p.date)
    const flows = shownAccounts.flatMap((account) =>
      cashFlowMarkers(histories.get(account.account_id)?.inputs?.activity ?? [], dates).map((flow) => ({ ...flow, account })),
    )
    const named = shownAccounts.length > 1
    const largest = Math.max(0, ...flows.map((f) => f.amount))
    return flows.map((f) => {
      const word = f.kind === 'deposit' ? 'DEPOSIT' : 'WITHDRAWAL'
      const amount = isMasked ? '' : ` ${formatAmount(f.amount)}`
      const where = named ? ` ${f.kind === 'deposit' ? 'TO' : 'FROM'} ${f.account.name.toUpperCase()}` : ''
      return {
        index: f.index,
        color: f.kind === 'deposit' ? colors.income : colors.expense,
        radius: markerRadius(f.amount, largest),
        label: `${word}${amount}${where}`,
      }
    })
  }, [shownAccounts, histories, visible, isMasked])
  const reading = windowReading(visible, selectedIndex)

  // Across every account the page lists the accounts — how each did, its share — each opening onto
  // its own positions. Every gain on the page — headline, accounts, positions — is measured from one
  // date: the chart's window in trend, and in breakdown the start of the history, so breakdown reads
  // exactly what trend does on ALL.
  const isAll = selectedAccount == null && investmentAccounts.length > 1
  const historyStart = trendPoints[0]?.date ?? null
  const windowStart = isTrend ? (visible[0]?.date ?? null) : historyStart
  const accountSummaries = useMemo<AccountSummaryRow[]>(() => {
    if (!isAll) return []
    return [...investmentAccounts]
      .sort((a, b) => (b.balances?.current ?? 0) - (a.balances?.current ?? 0))
      .map((account) => {
        const points = histories.get(account.account_id)?.history?.points
        return {
          accountId: account.account_id,
          name: account.name,
          logo: account.institutionLogo || null,
          icon: accountFallbackIcon('investment', account.itemId),
          value: account.balances?.current ?? 0,
          gain: points && windowStart ? rangeGain(fillCalendarDays(points), windowStart) : null,
          holdings: holdingsByAccount.get(account.account_id) ?? [],
        }
      })
  }, [isAll, investmentAccounts, histories, windowStart, holdingsByAccount])
  // Each position's change from the same date. Read against the account's own trades — pooled
  // across accounts they'd undo the wrong position.
  const changeFor = useMemo(
    () =>
      windowStart
        ? (holding: Holding, accountId: string): HoldingChange | null => {
            const inputs = histories.get(accountId)?.inputs
            if (!inputs) return null
            return holdingRangeChange({
              holding,
              activity: inputs.activity,
              closes: inputs.closes,
              splits: inputs.splits,
              start: windowStart,
              today: investmentHistory.today,
            })
          }
        : undefined,
    [windowStart, histories, investmentHistory.today],
  )
  const windowUp = ((visible.length >= 2 ? rangeGain(visible, visible[0].date)?.gain : 0) ?? 0) >= 0
  // Trend reads the chart's window, like Net Worth; breakdown reads the whole history, what trend
  // shows on ALL. Both fall back to total return until the line exists.
  const shown = isTrend
    ? (reading?.gain ?? totalGain)
    : ((historyStart && trendPoints.length >= 2 ? rangeGain(trendPoints, historyStart) : null) ?? totalGain)
  const shownColor = shown
    ? shown.pct != null
      ? performanceColor(shown.pct).base
      : shown.gain >= 0
        ? colors.income
        : colors.expense
    : colors.textMuted

  const days = useMemo(() => groupByDay(items), [items])
  const shownDays = days.slice(0, TRANSFER_DAY_LIMIT)
  const hiddenCount = days.slice(TRANSFER_DAY_LIMIT).reduce((sum, day) => sum + day.items.length, 0)

  if (!portfolio.accounts.isLoading && investmentAccounts.length === 0) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }} edges={['top']}>
        <EmptyState message="Link a brokerage or retirement account to see your investments here." />
      </SafeAreaView>
    )
  }


  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }} edges={['top']}>
      <ScrollView contentInsetAdjustmentBehavior="automatic" contentContainerClassName="px-5 pb-10 pt-3" refreshControl={refreshControl}>
        <View className="flex-row items-center justify-between pb-3">
          <View className="flex-row gap-1">
            <Pill label="Trend" isSelected={isTrend} onPress={() => setView('trend')} />
            <Pill label="Breakdown" isSelected={!isTrend} onPress={() => setView('breakdown')} />
          </View>
          <View className="rounded-full px-3 py-1.5" style={{ backgroundColor: colors.primaryMuted }}>
            <AccountsFilterDropdown accounts={investmentAccounts} selectedAccountId={selectedAccount?.account_id ?? null} onSelect={setFilterId} />
          </View>
        </View>

        <TransactionEditorErrorBanner />

        <View className="items-start pb-2">
          <Text className="font-display text-2xl text-textPrimary">
            {formatMaskableAmount(isTrend && reading ? reading.value : balance, isMasked)}
          </Text>
          {shown ? (
            <View className="mt-1 flex-row items-center gap-1.5">
              {shown.gain !== 0 ? <Ionicons name={shown.gain > 0 ? 'caret-up' : 'caret-down'} size={14} color={shownColor} /> : null}
              <Text className="font-sansSemi text-base" style={{ color: shownColor }}>
                {formatMaskableAmount(Math.abs(shown.gain), isMasked)}
                {shown.pct != null ? ` (${formatGainPct(shown.pct)})` : ''}
              </Text>
            </View>
          ) : null}
          {asOfLabel ? (
            <Pressable onPress={() => setShowRefreshInfo((v) => !v)} hitSlop={8} className="mt-1 flex-row items-center gap-1">
              <Text className="font-sansMed text-sm text-textSecondary">Updated {asOfLabel}</Text>
              <Ionicons name="information-circle-outline" size={15} color={colors.textSecondary} />
            </Pressable>
          ) : null}
          <Modal visible={showRefreshInfo} transparent animationType="fade" onRequestClose={() => setShowRefreshInfo(false)}>
            <Pressable
              className="flex-1 items-center justify-center px-10"
              style={{ backgroundColor: 'rgba(0,0,0,0.45)' }}
              onPress={() => setShowRefreshInfo(false)}
            >
              <View className="w-full rounded-2xl p-5" style={{ backgroundColor: colors.surface }}>
                <Text className="font-sansSemi text-sm text-textPrimary">How often values update</Text>
                <Text className="mt-2 font-sans text-xs leading-5 text-textMuted">
                  Stocks and ETFs are priced at their latest trade, which can be up to 15 minutes old. Funds, bonds and
                  cash use your brokerage&apos;s own price, which Plaid collects about once every market day, usually after
                  close. Share counts also come from your brokerage, so a trade made today shows once it reports it.
                </Text>
                <Text className="mt-2 font-sans text-xs leading-5 text-textMuted">
                  The time shown is the oldest price in view, so it never claims more than the whole portfolio has.
                </Text>
              </View>
            </Pressable>
          </Modal>
        </View>

        {holdingsLoading && !hasHoldings ? (
          <View className="items-center py-8">
            <ActivityIndicator color={colors.primary} />
          </View>
        ) : holdingsFailed ? (
          <Text className="py-8 text-center font-sans text-sm text-textMuted">
            {needsRelink
              ? 'This institution needs to be reconnected to share holdings. Remove and relink it from Settings → Institutions.'
              : "Couldn't load holdings."}
          </Text>
        ) : !hasHoldings ? (
          <Text className="py-8 text-center font-sans text-sm text-textMuted">No holdings to show</Text>
        ) : (
          <>
            {isTrend ? (
              // Edge to edge, like the net worth chart: the negative margin cancels the side padding.
              <View className="mb-6 mt-2" style={{ marginHorizontal: -spacing[5] }}>
                {history ? (
                  <InvestmentHistoryChart
                    history={history}
                    points={linePoints}
                    slots={visible}
                    granularity={GRANULARITY}
                    slotStart={slots.first}
                    slotCount={slots.count}
                    baseline={visible[0]?.value ?? 0}
                    isUp={windowUp}
                    selectedIndex={selectedIndex}
                    onSelect={handleSelect}
                    onZoomStart={handleZoomStart}
                    onZoomEnd={handleZoomEnd}
                    onZoom={handleZoom}
                    activeRange={activeRange}
                    onRangeChange={chooseRange}
                    markers={flowMarkers}
                    isLoading={investmentHistory.isLoading}
                    isRateLimited={investmentHistory.isRateLimited}
                    tradesUnavailable={investmentHistory.tradesUnavailable}
                    isMasked={isMasked}
                  />
                ) : (
                  <View className="items-center justify-center" style={{ height: 220 }}>
                    <ActivityIndicator color={colors.textMuted} />
                  </View>
                )}
              </View>
            ) : (
              // Breakdown: what it's made of — the classes as one bar, then each holding sized.
              <View className="mb-6 mt-2 gap-5">
                <AssetAllocation holdings={holdings} />
                <HoldingsHeatMap holdings={holdings} selectedId={selectedId} onSelect={setSelectedId} />
              </View>
            )}
            {/* A tile highlights its row; a row opens the holding's own page. */}
            {isAll ? (
              <AccountList
                rows={accountSummaries}
                isMasked={isMasked}
                changeFor={changeFor}
                selectedHoldingId={selectedId}
                onSelectHolding={setSelectedId}
                onOpenHolding={openHolding}
                onOpenAccount={setFilterId}
              />
            ) : (
              <HoldingRows
                holdings={holdings}
                isMasked={isMasked}
                selectedId={selectedId}
                onSelect={setSelectedId}
                onOpen={openHolding}
                // One account in view, picked or the only one: its own trades read its positions.
                changeFor={changeFor && shownAccounts.length === 1 ? (holding) => changeFor(holding, shownAccounts[0].account_id) : undefined}
              />
            )}
          </>
        )}

        {/* Money moved in and out of the account. One account only: across all of them the list is
            mostly transfers between them, which say nothing about performance. */}
        {selectedAccount && items.length > 0 ? (
          <>
            <View className="mb-1 mt-8 flex-row items-baseline justify-between">
              <Text className="font-sansSemi text-md text-textPrimary">Transfers</Text>
              {principal !== null ? (
                <Text className="font-sansSemi text-base text-textSecondary">
                  {formatMaskableAmount(Math.abs(principal), isMasked)} {principal < 0 ? 'out' : 'in'}
                </Text>
              ) : null}
            </View>
            <InvestmentTransferDays shownDays={shownDays} categoryById={categoryById} />
            {hiddenCount > 0 ? (
              <Text className="py-3 text-center font-sans text-xs text-textMuted">
                {hiddenCount} older {hiddenCount === 1 ? 'transfer' : 'transfers'} not shown
              </Text>
            ) : null}
          </>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  )
}

/** The transfer rows, as their own component so only this leaf subscribes to the editor's context. */
function InvestmentTransferDays({
  shownDays,
  categoryById,
}: {
  shownDays: { date: string; items: FeedItem[] }[]
  categoryById: Map<string, Category>
}) {
  const { openTransaction } = useTransactionEditorActions()
  return (
    <>
      {shownDays.map((day) => (
        <View key={day.date}>
          <DayGroupHeader date={day.date} items={day.items} />
          {day.items.map((item) => {
            const category = item.categoryId ? categoryById.get(item.categoryId) : undefined
            return (
              <View key={item.id} className="border-t" style={{ borderColor: colors.border }}>
                <TransactionRow
                  item={item}
                  categoryName={category?.name ?? 'Uncategorized'}
                  categoryColor={category?.color ?? colors.textMuted}
                  categoryIcon={category?.icon ?? null}
                  reimbursementCategoryName={
                    item.reimbursementCategoryId ? (categoryById.get(item.reimbursementCategoryId)?.name ?? null) : null
                  }
                  onPress={openTransaction}
                />
              </View>
            )
          })}
        </View>
      ))}
    </>
  )
}
