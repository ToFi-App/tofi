import { useMemo, useState } from 'react'
import { ActivityIndicator, Pressable, ScrollView, Text, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { router } from 'expo-router'
import { colors, hexToRgba, pageBackdrop } from '@/constants/theme'
import { useTransactionFeed } from '@/hooks/useTransactionFeed'
import { usePullToRefresh } from '@/hooks/usePullToRefresh'
import { useAmountsMasked } from '@/hooks/useAmountsMasked'
import { useHoldings } from '@/hooks/useHoldings'
import { useInvestmentScope } from '@/hooks/useInvestmentScope'
import { useInvestmentAccountFilter } from '@/hooks/useInvestmentAccountFilter'
import { useTrendViewport } from '@/hooks/useTrendViewport'
import { HoldingRows, type HoldingChange } from '@/components/accounts/HoldingRows'
import { accountFallbackIcon } from '@/components/accounts/AccountRow'
import { SecurityMark } from '@/components/accounts/SecurityMark'
import { AccountList, AllocationDonut, type AccountSummaryRow } from '@/components/investments/PortfolioSummary'
import { FreshnessInfo } from '@/components/investments/FreshnessInfo'
import { InvestmentHistoryChart } from '@/components/accounts/InvestmentHistoryChart'
import { AccountsFilterDropdown } from '@/components/ui/AccountsFilterDropdown'
import { EmptyState } from '@/components/ui/EmptyState'
import { IconSwitch, type IconSwitchOption } from '@/components/ui/IconSwitch'
import { NetWorthHeader } from '@/components/networth/NetWorthHeader'
import { BalanceHeadline } from '@/components/networth/BalanceHeadline'
import { ChangeLabel } from '@/components/networth/ChangeLabel'
import { SectionTitle } from '@/components/networth/ListCard'
import { RANGE_LABELS } from '@/components/networth/RangeTabs'
import { DayGroupHeader } from '@/components/transactions/DayGroupHeader'
import { TransactionRow } from '@/components/transactions/TransactionRow'
import {
  TransactionEditorErrorBanner,
  useTransactionEditorActions,
} from '@/components/transactions/TransactionEditorProvider'
import { assetClass, changeColor, formatGainPct, holdingLabel, holdingsPricedAsOf, monogramText } from '@/lib/accounts/holdings'
import { investmentHeadlineGain, netPrincipal } from '@/lib/accounts/principal'
import { computeNetWorthTotals } from '@/lib/accounts/netWorth'
import { bucketOf, formatTrendLabel, type Granularity, type TrendRange } from '@/lib/accounts/netWorthHistory'
import { dayOf, viewportBuckets, visiblePoints } from '@/lib/accounts/trendViewport'
import { cashFlowMarkers, fillCalendarDays, rangeGain, windowReading } from '@/lib/investments/accountHistory'
import { holdingRangeChange } from '@/lib/investments/portfolio'
import { securityLogoUrl } from '@/lib/investments/securityLogo'
import { markerRadius } from '@/lib/charts/markers'
import { formatAmount, formatMaskableAmount } from '@/lib/format/money'
import { groupByDay } from '@/lib/transactions/groupByDay'
import type { FeedItem } from '@/lib/transactions/resolveFeed'
import type { Category, Holding } from '@/types/domain'
import { TabBarSpacer } from '@/components/navigation/FloatingTabs'
import { PageBackdrop } from '@/components/ui/PageBackdrop'

// Capped by day, not by row: a partially-shown day would print an IN/OUT total covering rows the
// user can't see.
const TRANSFER_DAY_LIMIT = 12
const DEFAULT_RANGE: TrendRange = '1W'
const GRANULARITY: Granularity = 'day'
/** How many of the window's biggest movers sit under the chart. */
const MOVER_COUNT = 3

/** Trend is the value over time; breakdown is what it's made of today, as the allocation ring. */
type InvestmentView = 'trend' | 'breakdown'

type Mover = { holding: Holding; change: HoldingChange & { pct: number } }

/**
 * How the investments are doing: the portfolio line, which holdings moved it, and what's held.
 *
 * One screen for every account and for each one alone. Opened from the switcher it shows whatever
 * was last picked; Net Worth's investment rows set the picker to their account before switching
 * here, so tapping an account lands straight on its performance with nothing in between.
 */
export function InvestmentsScreen() {
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
  // The switcher's totals: net worth on the same live balances the Overview shows, and every
  // investment account together whatever the filter here.
  const switcherTotals = useMemo(() => {
    const invested = investmentAccounts.reduce((sum, a) => sum + (a.balances?.current ?? 0), 0)
    return {
      overview: portfolio.liveAccounts ? computeNetWorthTotals(portfolio.liveAccounts, feed).netWorth : null,
      investments: investmentAccounts.length > 0 ? invested : null,
    }
  }, [portfolio.liveAccounts, investmentAccounts, feed])

  const shownItemIds = useMemo(() => [...new Set(shownAccounts.map((a) => a.itemId))], [shownAccounts])

  const [view, setView] = useState<InvestmentView>('trend')
  const isTrend = view === 'trend'
  // A holding's own page, pushed on this tab's stack: it slides in, and swipes back. Opened with the
  // picked account it's scoped to that account, so a security held in two accounts shows only that
  // account's shares and trades; across every account, the security merged into one position.
  const openHolding = (securityId: string) =>
    router.push({
      pathname: '/(tabs)/net-worth/holding',
      params: { securityId, accountId: selectedAccount?.account_id ?? '' },
    })

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
  // Deposits and withdrawals as dots on the line, read from each account's own activity. Money moved
  // in or out isn't performance, so the dots take the brand teal and grey, not gain or loss. Across
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
        color: f.kind === 'deposit' ? colors.primary : colors.textSecondary,
        radius: markerRadius(f.amount, largest),
        label: `${word}${amount}${where}`,
      }
    })
  }, [shownAccounts, histories, visible, isMasked])
  const reading = windowReading(visible, selectedIndex)

  // Across every account the page lists the accounts — how each did — each opening onto its own
  // view. Every gain on the page — headline, accounts, positions — is measured from one date: the
  // chart's window in trend, and in breakdown the start of the history, so breakdown reads exactly
  // what trend does on ALL.
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
  // The window's biggest moves, up or down, among the positions in view: each security once, read in
  // the account holding most of it. Cash doesn't move.
  const movers = useMemo<Mover[]>(() => {
    if (!changeFor) return []
    const best = new Map<string, Mover>()
    for (const account of shownAccounts) {
      for (const holding of holdingsByAccount.get(account.account_id) ?? []) {
        if (holding.type === 'cash') continue
        const change = changeFor(holding, account.account_id)
        if (!change || change.pct == null) continue
        const held = best.get(holding.securityId)
        if (held && (held.holding.institutionValue ?? 0) >= (holding.institutionValue ?? 0)) continue
        best.set(holding.securityId, { holding, change: { gain: change.gain, pct: change.pct } })
      }
    }
    return [...best.values()].sort((a, b) => Math.abs(b.change.pct) - Math.abs(a.change.pct)).slice(0, MOVER_COUNT)
  }, [changeFor, shownAccounts, holdingsByAccount])
  const windowUp = ((visible.length >= 2 ? rangeGain(visible, visible[0].date)?.gain : 0) ?? 0) >= 0
  // Trend reads the chart's window, like Net Worth; breakdown reads the whole history, what trend
  // shows on ALL. Both fall back to total return until the line exists.
  const shown = isTrend
    ? (reading?.gain ?? totalGain)
    : ((historyStart && trendPoints.length >= 2 ? rangeGain(trendPoints, historyStart) : null) ?? totalGain)
  const caption = !isTrend
    ? RANGE_LABELS.ALL
    : selectedIndex != null && visible[selectedIndex]
      ? formatTrendLabel(visible[selectedIndex].date, GRANULARITY, 'long')
      : activeRange
        ? RANGE_LABELS[activeRange]
        : undefined
  const weightOf = useMemo(() => {
    const total = holdings.reduce((sum, h) => sum + Math.max(0, h.institutionValue ?? 0), 0)
    return (holding: Holding) => (total > 0 ? Math.max(0, holding.institutionValue ?? 0) / total : 0)
  }, [holdings])

  const days = useMemo(() => groupByDay(items), [items])
  const shownDays = days.slice(0, TRANSFER_DAY_LIMIT)
  const hiddenCount = days.slice(TRANSFER_DAY_LIMIT).reduce((sum, day) => sum + day.items.length, 0)

  const header = (
    <NetWorthHeader
      totals={switcherTotals}
      isMasked={isMasked}
      actions={
        investmentAccounts.length > 0 ? (
          <View className="items-center justify-center" style={{ width: 44, height: 44 }}>
            <View
              className="items-center justify-center rounded-full"
              style={{ width: 36, height: 36, borderWidth: 1, borderColor: colors.borderCard }}
            >
              <AccountsFilterDropdown
                accounts={investmentAccounts}
                selectedAccountId={selectedAccount?.account_id ?? null}
                onSelect={setFilterId}
                variant="icon"
              />
            </View>
          </View>
        ) : null
      }
    />
  )

  if (!portfolio.accounts.isLoading && investmentAccounts.length === 0) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: pageBackdrop.stops[0] }} edges={['top']}>
        <PageBackdrop />
        {/* The switcher stays reachable with nothing to show, or the tab would strand you here. */}
        <View className="pt-3">{header}</View>
        <EmptyState message="Link a brokerage or retirement account to see your investments here." />
      </SafeAreaView>
    )
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: pageBackdrop.stops[0] }} edges={['top']}>
      <PageBackdrop />
      <ScrollView contentInsetAdjustmentBehavior="automatic" contentContainerClassName="pb-10 pt-3" refreshControl={refreshControl}>
        {header}

        <View className="px-5">
          <TransactionEditorErrorBanner />
        </View>

        <View className="mt-6">
          <BalanceHeadline
            label={selectedAccount ? selectedAccount.name : 'Your portfolio'}
            value={isTrend && reading ? reading.value : balance}
            change={shown ? { amount: shown.gain, pct: shown.pct } : null}
            caption={shown ? caption : undefined}
            isMasked={isMasked}
            info={hasHoldings ? <FreshnessInfo itemIds={shownItemIds} pricedAsOf={holdingsPricedAsOf(holdings)} /> : undefined}
          />
        </View>

        {/* Trend or Allocation, as a small icon switch beside the section's name. */}
        <View className="mt-7 px-5">
          <SectionTitle
            title={isTrend ? 'Trending' : 'Allocation'}
            right={hasHoldings ? <IconSwitch options={VIEW_OPTIONS} value={view} onChange={setView} size="sm" /> : undefined}
          />
        </View>

        {holdingsLoading && !hasHoldings ? (
          <View className="items-center py-8">
            <ActivityIndicator color={colors.primary} />
          </View>
        ) : holdingsFailed ? (
          <Text className="px-5 py-8 text-center font-sans text-sm text-textMuted">
            {needsRelink
              ? 'This institution needs to be reconnected to share holdings. Remove and relink it from Settings → Institutions.'
              : "Couldn't load holdings."}
          </Text>
        ) : !hasHoldings ? (
          <Text className="py-8 text-center font-sans text-sm text-textMuted">No holdings to show</Text>
        ) : (
          <>
            {isTrend ? (
              <View className="mt-2">
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
              <View className="mt-5 px-5 pb-1">
                <AllocationDonut holdings={holdings} />
              </View>
            )}

            <View className="mt-6 gap-7 px-5">
              <SummaryStrip totalGain={totalGain} principal={principal} isMasked={isMasked} />

              {isTrend && movers.length > 0 ? (
                <View className="gap-3">
                  <SectionTitle
                    title="Top movers"
                    right={caption ? <Text className="font-sans text-xs text-textSecondary">{caption}</Text> : undefined}
                  />
                  <View className="flex-row gap-2.5">
                    {movers.map((mover) => (
                      <MoverTile key={mover.holding.securityId} mover={mover} isMasked={isMasked} onPress={() => openHolding(mover.holding.securityId)} />
                    ))}
                  </View>
                </View>
              ) : null}

              <View className="gap-3">
                <SectionTitle
                  title={isTrend ? 'Your positions' : 'Your assets'}
                  right={
                    <Text className="font-sans text-xs text-textSecondary">
                      {!isTrend ? 'Share of portfolio' : changeFor && shownAccounts.length === 1 ? caption : 'Total return'}
                    </Text>
                  }
                />
                <HoldingRows
                  holdings={holdings}
                  isMasked={isMasked}
                  onOpen={openHolding}
                  // One account in view, picked or the only one: its own trades read its positions.
                  changeFor={isTrend && changeFor && shownAccounts.length === 1 ? (holding) => changeFor(holding, shownAccounts[0].account_id) : undefined}
                  weightOf={isTrend ? undefined : weightOf}
                />
              </View>

              {isAll ? (
                <View className="gap-3">
                  <SectionTitle title="Accounts" />
                  <AccountList rows={accountSummaries} isMasked={isMasked} onOpenAccount={setFilterId} />
                </View>
              ) : null}
            </View>
          </>
        )}

        {/* Money moved in and out of the account. One account only: across all of them the list is
            mostly transfers between them, which say nothing about performance. */}
        {selectedAccount && items.length > 0 ? (
          <View className="px-5">
            <View className="mb-1 mt-8 flex-row items-baseline justify-between">
              <SectionTitle title="Transfers" />
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
          </View>
        ) : null}
        <TabBarSpacer />
      </ScrollView>
    </SafeAreaView>
  )
}

/**
 * The portfolio's two lifetime figures side by side in one rimmed strip: what it has made — total
 * return, in gain green or loss red — and what was put in, net of withdrawals.
 */
function SummaryStrip({
  totalGain,
  principal,
  isMasked,
}: {
  totalGain: { gain: number; pct: number | null } | null
  principal: number | null
  isMasked: boolean
}) {
  if (!totalGain && principal == null) return null
  return (
    <View
      className="flex-row"
      style={{ borderRadius: 12, borderWidth: 1, borderColor: colors.borderCard, backgroundColor: colors.surfaceRow }}
    >
      <View className="flex-1 gap-1 px-3.5 py-3" style={{ borderRightWidth: 1, borderColor: colors.borderCard }}>
        <Text className="font-sans text-xs text-textSecondary">Total return</Text>
        {totalGain ? (
          <>
            <Text className="font-sansSemi text-base text-textPrimary" style={{ fontVariant: ['tabular-nums'] }}>
              {`${totalGain.gain >= 0 ? '+' : '−'}${formatMaskableAmount(Math.abs(totalGain.gain), isMasked)}`}
            </Text>
            {totalGain.pct != null ? <ChangeLabel change={totalGain.gain} text={`${formatGainPct(totalGain.pct)} all time`} size="xs" /> : null}
          </>
        ) : (
          <Text className="font-sansSemi text-base text-textMuted">—</Text>
        )}
      </View>
      <View className="flex-1 gap-1 px-3.5 py-3">
        <Text className="font-sans text-xs text-textSecondary">Put in</Text>
        <Text className="font-sansSemi text-base text-textPrimary" style={{ fontVariant: ['tabular-nums'] }}>
          {principal != null ? formatMaskableAmount(principal, isMasked) : '—'}
        </Text>
        <Text className="font-sans text-xs text-textSecondary">Net of withdrawals</Text>
      </View>
    </View>
  )
}

/**
 * One of the window's biggest movers: its mark, symbol and name, then its value and a chip with how
 * far it moved, tinted gain green or loss red. Opens the holding's own page.
 */
function MoverTile({ mover, isMasked, onPress }: { mover: Mover; isMasked: boolean; onPress: () => void }) {
  const { holding, change } = mover
  const label = holdingLabel(holding)
  const tone = changeColor(change.gain)
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${label}, ${formatGainPct(change.pct)}`}
      className="flex-1 items-center"
      style={{ borderRadius: 12, borderWidth: 1, borderColor: colors.borderCard, backgroundColor: colors.surfaceRow }}
    >
      <View className="items-center gap-1.5 px-2 pb-3 pt-3.5">
        <SecurityMark uri={securityLogoUrl(holding)} monogram={monogramText(label)} color={assetClass(holding.type).color} size={36} />
        <Text className="font-sansSemi text-amount text-textPrimary" numberOfLines={1}>
          {label}
        </Text>
        {holding.name ? (
          <Text className="font-sans text-xs text-textSecondary" numberOfLines={1}>
            {holding.name}
          </Text>
        ) : null}
      </View>
      <View className="w-full items-center gap-1.5 pb-3 pt-2.5" style={{ borderTopWidth: 1, borderColor: colors.borderCard }}>
        <Text className="font-sansSemi text-amount text-textPrimary" style={{ fontVariant: ['tabular-nums'] }} numberOfLines={1}>
          {holding.institutionValue != null ? formatMaskableAmount(holding.institutionValue, isMasked) : '—'}
        </Text>
        <View className="rounded-full px-2 py-0.5" style={{ backgroundColor: hexToRgba(tone, 0.12) }}>
          <ChangeLabel change={change.gain} text={formatGainPct(change.pct)} size="xs" />
        </View>
      </View>
    </Pressable>
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

const VIEW_OPTIONS: Array<IconSwitchOption<InvestmentView>> = [
  { value: 'trend', icon: 'analytics-outline', label: 'Trend' },
  { value: 'breakdown', icon: 'pie-chart-outline', label: 'Allocation' },
]
