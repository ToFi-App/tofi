import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { Pressable, ScrollView, Text, View } from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { colors } from '@/constants/theme'
import { formatAmount } from '@/lib/format/money'
import { computeAccountHistory, netWorthFromAccounts, netWorthYearRange } from '@/lib/accounts/netWorthHistory'
import { CASH_ON_HAND_KEY } from '@/lib/accounts/composition'
import type { AccountMonthPoint, MonthPoint } from '@/lib/accounts/netWorthHistory'
import { buildNetWorthSeries, periodStart, type NetWorthSeries } from '@/lib/accounts/netWorthSeries'
import { NetWorthTrendChart } from './NetWorthTrendChart'
import { NetWorthCompositionMap } from './NetWorthCompositionMap'
import { NetWorthAccountRows } from './NetWorthAccountRows'
import { BottomSheet, useSheetScroll } from '@/components/ui/BottomSheet'
import { TEAL_SHEET_BACKDROP } from '@/components/ui/TealSheetBackdrop'
import type { FeedItem } from '@/lib/transactions/resolveFeed'
import type { Account } from '@/types/domain'

interface NetWorthTrendSheetProps {
  visible: boolean
  onClose: () => void
  netWorth: number
  accounts: Account[]
  feed: FeedItem[]
  isLoading: boolean
}

// Deliberately exempt from the app-wide `useAmountsMasked` toggle: this sheet exists to show
// the net worth trajectory, and a chart of masked amounts would have nothing left to say.
// Every other balance surface (HeroCard, AccountRow, AccountDetailSheet) does honour it.
function changeColor(change: number): string {
  if (change > 0) return colors.income
  if (change < 0) return colors.expense
  return colors.textMuted
}

interface TrendPanelProps {
  points: MonthPoint[]
  accountPoints: AccountMonthPoint[]
  series: NetWorthSeries[]
  start: Map<string, number>
  baseline: number
  netWorth: number
  /** Shown in place of the chart when there are no months to draw. */
  emptyMessage: string
  /** Rendered between the chart and the account rows. */
  scopePicker: ReactNode
  accounts: Account[]
  feed: FeedItem[]
}

/**
 * Everything that reads the selected month — headline, chart, composition map, account rows — and
 * the selection state itself.
 *
 * The state lives HERE rather than in the sheet on purpose. BottomSheet republishes its whole
 * tree to the sheet host after every render of its owner, so state held by the sheet made each
 * tap re-render the composition map, the month list and every logo, in two passes. Held down
 * here, a selection re-renders this subtree and nothing else.
 */
function TrendPanel({
  points,
  accountPoints,
  series,
  start,
  baseline,
  netWorth,
  emptyMessage,
  scopePicker,
  accounts,
  feed,
}: TrendPanelProps) {
  // Everything that reads a month follows the selection, and falls back to the latest month when
  // nothing is selected.
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null)
  const handleSelect = useCallback((index: number | null) => setSelectedIndex(index), [])
  const readIndex = selectedIndex != null && selectedIndex < points.length ? selectedIndex : points.length - 1
  const reading = points[readIndex]
  const headlineChange = reading ? Math.round((reading.netWorth - baseline) * 100) / 100 : 0
  const readMonth = accountPoints[readIndex]
  // One highlighted account, set from a map tile or an account row and shown in all three: its
  // tile outlined, its row tinted, its segment solid in every bar.
  const [highlightedKey, setHighlightedKey] = useState<string | null>(null)

  return (
    <>
      <View className="px-5 pb-2 pt-1">
        <Text className="font-display text-2xl text-textPrimary">{formatAmount(reading?.netWorth ?? netWorth)}</Text>
        {reading ? (
          <View className="mt-1 flex-row items-center gap-1.5">
            {headlineChange !== 0 ? (
              <Ionicons name={headlineChange > 0 ? 'caret-up' : 'caret-down'} size={14} color={changeColor(headlineChange)} />
            ) : null}
            <Text className="font-sansSemi text-base" style={{ color: changeColor(headlineChange) }}>
              {formatAmount(Math.abs(headlineChange))}
            </Text>
          </View>
        ) : null}
      </View>

      {points.length === 0 ? (
        <View className="items-center py-24">
          <Text className="font-sans text-sm text-textMuted">{emptyMessage}</Text>
        </View>
      ) : (
        <NetWorthTrendChart
          points={points}
          accountPoints={accountPoints}
          series={series}
          baseline={baseline}
          selectedIndex={selectedIndex}
          onSelect={handleSelect}
          highlightedKey={highlightedKey}
        />
      )}

      {scopePicker}

      {/* Below the chart rather than between it and the headline, which is the chart's reading.
          Sits directly above the account rows it summarizes, and follows the chart: the period
          the pills pick and the month selected in it. */}
      {readMonth ? (
        <View className="px-5 pt-6">
          <NetWorthCompositionMap
            accounts={accounts}
            feed={feed}
            balances={readMonth.balances}
            selectedKey={highlightedKey}
            onSelectKey={setHighlightedKey}
          />
        </View>
      ) : null}

      {points.length > 0 ? (
        <NetWorthAccountRows
          months={accountPoints}
          series={series}
          start={start}
          index={readIndex}
          highlightedKey={highlightedKey}
          onHighlight={setHighlightedKey}
        />
      ) : null}
    </>
  )
}

export function NetWorthTrendSheet({ visible, onClose, netWorth, accounts, feed, isLoading }: NetWorthTrendSheetProps) {
  const insets = useSafeAreaInsets()
  const sheetScroll = useSheetScroll()

  const linkedAccountIds = useMemo(() => new Set(accounts.map((a) => a.account_id)), [accounts])

  // One scope selector covers both readings of the line: a single year for the close-up,
  // 'all' for the long arc. Defaults to the current year, and re-seeds on every open so a
  // past visit's choice doesn't linger.
  const currentYear = new Date().getFullYear()
  const [scope, setScope] = useState<number | 'all'>(currentYear)
  useEffect(() => {
    if (visible) setScope(currentYear)
  }, [visible, currentYear])

  const range = useMemo(() => netWorthYearRange(feed, linkedAccountIds), [feed, linkedAccountIds])
  // Oldest first, ALL last — read left to right like a timeline, the way 1D…ALL does.
  const scopeOptions = useMemo<Array<number | 'all'>>(() => {
    const years: Array<number | 'all'> = []
    for (let year = range.first; year <= range.last; year++) years.push(year)
    years.push('all')
    return years
  }, [range])

  const { series, anchors } = useMemo(() => buildNetWorthSeries(accounts, feed), [accounts, feed])
  // Cash accounts can't sit below zero and debt can't sit in credit, so a leftover of the wrong
  // sign before an account's first transaction means it didn't exist yet (see expectedSign).
  // Investments and the manual cash pot are left out on purpose.
  const expectedSign = useMemo(() => {
    const signs = new Map<string, 1 | -1>()
    for (const s of series) {
      if (s.key === CASH_ON_HAND_KEY || s.group === 'investment') continue
      signs.set(s.key, s.group === 'liability' ? -1 : 1)
    }
    return signs
  }, [series])
  const accountPoints = useMemo(
    () =>
      computeAccountHistory(anchors, feed, linkedAccountIds, scope === 'all' ? undefined : scope, new Date(), {
        expectedSign,
      }),
    [anchors, feed, linkedAccountIds, scope, expectedSign],
  )
  // The line summed from the per-account history, so the bars and the line are one calculation —
  // an account appearing from zero included.
  const points = useMemo(() => netWorthFromAccounts(accountPoints), [accountPoints])
  const start = useMemo(() => periodStart(accountPoints), [accountPoints])
  // Net worth as the period opened: the dotted line, and what the headline change is measured from.
  const baseline = points.length > 0 ? points[0].netWorth - points[0].change : 0

  return (
    <BottomSheet
      visible={visible}
      onClose={onClose}
      topOffset={insets.top + 20}
      contentScroll={sheetScroll}
      background={TEAL_SHEET_BACKDROP}
      // The default pill is near-white and disappears into the tinted top edge.
      grabberColor={colors.textMuted}
    >
      <View className="flex-row items-center justify-between px-5 py-3">
        <Pressable onPress={onClose} hitSlop={8} accessibilityLabel="Close">
          <Ionicons name="close" size={22} color={colors.textSecondary} />
        </Pressable>
        <Text className="flex-1 text-center font-display text-md text-textPrimary">Net Worth</Text>
        <View style={{ width: 22 }} />
      </View>

      <ScrollView
        {...sheetScroll.scrollProps}
        // No horizontal padding here: the chart and the account rows run edge to edge, and every
        // other section carries its own 20px.
        contentContainerStyle={{ paddingBottom: insets.bottom + 24 }}
      >
        {/* Keyed by scope, so changing the period starts it with nothing selected. */}
        <TrendPanel
          key={String(scope)}
          points={points}
          accountPoints={accountPoints}
          series={series}
          start={start}
          baseline={baseline}
          netWorth={netWorth}
          accounts={accounts}
          feed={feed}
          emptyMessage={isLoading && points.length === 0 ? 'Loading history…' : scope === 'all' ? 'No history yet' : `No history for ${scope}`}
          scopePicker={
            <View className="flex-row justify-around px-5 pt-3">
              {scopeOptions.map((option) => {
                const isSelected = option === scope
                const label = option === 'all' ? 'ALL' : String(option)
                return (
                  <Pressable
                    key={label}
                    onPress={() => setScope(option)}
                    accessibilityLabel={option === 'all' ? 'All time' : `Year ${option}`}
                    accessibilityState={{ selected: isSelected }}
                    hitSlop={6}
                    className="rounded-full px-3.5 py-1.5"
                    style={isSelected ? { backgroundColor: colors.primary } : undefined}
                  >
                    <Text className="font-sansSemi text-sm" style={{ color: isSelected ? colors.surface : colors.primary }}>
                      {label}
                    </Text>
                  </Pressable>
                )
              })}
            </View>
          }
        />
      </ScrollView>
    </BottomSheet>
  )
}
