import { useCallback, useMemo, useState } from 'react'
import { Pressable, ScrollView, Text, View } from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import { SafeAreaView } from 'react-native-safe-area-context'
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router'
import { colors } from '@/constants/theme'
import { useTransactionFeed } from '@/hooks/useTransactionFeed'
import { usePullToRefresh } from '@/hooks/usePullToRefresh'
import { useAccounts } from '@/hooks/useAccounts'
import { useAmountsMasked } from '@/hooks/useAmountsMasked'
import { MonthNavigator } from '@/components/transactions/MonthNavigator'
import { ErrorBanner } from '@/components/ui/ErrorBanner'
import { EmptyState } from '@/components/ui/EmptyState'
import { LoadingScreen } from '@/components/ui/LoadingScreen'
import { CashFlowHeadline } from '@/components/cashflow/CashFlowHeadline'
import { HouseholdFlowChart } from '@/components/cashflow/HouseholdFlowChart'
import { accountFallbackIcon, variantIcons } from '@/components/accounts/AccountRow'
import { FlowTransactionsSheet, type FlowSelection } from '@/components/cashflow/FlowTransactionsSheet'
import { flowKindLabels, laneColor, ribbonColor, roleColors, sideNodeMeta } from '@/components/cashflow/flowStyle'
import { buildFlowGraph } from '@/lib/cashflow/buildFlowGraph'
import { buildHouseholdFlow, type AccountCard, type Lane, type Ribbon, type SideNode } from '@/lib/cashflow/householdFlow'
import { formatMaskableAmount } from '@/lib/format/money'
import { round2 } from '@/lib/accounts/netWorth'
import { currentMonth, monthLabel, shiftMonth, type YearMonth } from '@/lib/transactions/filterByMonth'
import type { FeedItem } from '@/lib/transactions/resolveFeed'

const MAX_INCOME_ROWS = 4
const MAX_SPEND_ROWS = 6

function monthFromParams(params: { year?: string; month?: string }): YearMonth {
  const year = Number(params.year)
  const month = Number(params.month)
  if (Number.isInteger(year) && Number.isInteger(month) && month >= 1 && month <= 12) return { year, month }
  return currentMonth()
}

function byDateDesc(a: FeedItem, b: FeedItem): number {
  return b.date.localeCompare(a.date)
}

function signed(amount: number, isMasked: boolean): string {
  return `${amount > 0 ? '+' : ''}${formatMaskableAmount(amount, isMasked)}`
}

/**
 * Where the month's money came from and went. The chart looks at one subject at a time — the
 * household, or a single account — with its inflows on the left and outflows on the right, which
 * is what makes the flow between accounts readable: pick Checking and every transfer in and out
 * of it is a row of its own.
 *
 * Always all accounts: Home's account filter doesn't apply here, because a transfer only makes
 * sense with both ends in view.
 */
export default function CashFlowScreen() {
  const params = useLocalSearchParams<{ year?: string; month?: string }>()
  const [month, setMonth] = useState<YearMonth>(() => monthFromParams(params))
  // A hidden tab stays mounted, so each open re-reads the month Home passed rather than keeping
  // whichever month was being browsed last time.
  useFocusEffect(
    useCallback(() => {
      setMonth(monthFromParams({ year: params.year, month: params.month }))
    }, [params.year, params.month]),
  )

  const { feed, categoryById, isLoading, error, refresh } = useTransactionFeed()
  const refreshControl = usePullToRefresh(refresh)
  const accounts = useAccounts()
  const { isMasked } = useAmountsMasked()

  const [selection, setSelection] = useState<FlowSelection | null>(null)

  const graph = useMemo(() => buildFlowGraph({ feed, accounts: accounts.data ?? [], month }), [feed, accounts.data, month])
  const graphNodeById = useMemo(() => new Map(graph.nodes.map((node) => [node.id, node])), [graph.nodes])
  const feedById = useMemo(() => new Map(feed.map((item) => [item.id, item])), [feed])
  const flow = useMemo(() => buildHouseholdFlow(graph, { maxIncome: MAX_INCOME_ROWS, maxSpend: MAX_SPEND_ROWS }), [graph])

  const categoryFor = useCallback(
    (item: FeedItem) => {
      const category = item.categoryId ? categoryById.get(item.categoryId) : undefined
      return { name: category?.name ?? 'Uncategorized', color: category?.color ?? colors.textMuted, icon: category?.icon ?? null }
    },
    [categoryById],
  )
  const sideMeta = useCallback((node: SideNode) => sideNodeMeta(node, graphNodeById, categoryById), [graphNodeById, categoryById])
  const accountById = useMemo(() => new Map((accounts.data ?? []).map((a) => [a.account_id, a])), [accounts.data])
  const glyphFor = useCallback(
    (card: AccountCard) => {
      if (!card.accountId) return { logo: null, icon: variantIcons.cashOnHand }
      const account = accountById.get(card.accountId)
      const variant = card.role === 'debt' ? 'credit' : card.role === 'invested' ? 'investment' : 'cash'
      return { logo: account?.institutionLogo || null, icon: accountFallbackIcon(variant, account?.itemId) }
    },
    [accountById],
  )
  const cardName = useCallback((card: AccountCard) => card.name, [])
  const accountName = useCallback(
    (accountId: string | null) => (accountId ? (accountById.get(accountId)?.name ?? 'Removed account') : 'Cash on hand'),
    [accountById],
  )
  const itemsFor = useCallback(
    (itemIds: string[]) =>
      [...new Set(itemIds)]
        .map((id) => feedById.get(id))
        .filter((item): item is FeedItem => item != null)
        .sort(byDateDesc),
    [feedById],
  )
  const sideById = useMemo(() => new Map([...flow.inNodes, ...flow.outNodes].map((n) => [n.id, n])), [flow])
  const nameOf = useCallback(
    (id: string) => {
      const sideNode = sideById.get(id)
      return sideNode ? sideMeta(sideNode).label : (graphNodeById.get(id)?.label ?? 'Account')
    },
    [sideById, sideMeta, graphNodeById],
  )

  const openRibbon = useCallback(
    (ribbon: Ribbon) => {
      const outside = sideById.get(sideById.has(ribbon.from) ? ribbon.from : ribbon.to)
      setSelection({
        title: `${nameOf(ribbon.from)} → ${nameOf(ribbon.to)}`,
        subtitle: ribbon.kind === 'income' ? 'Income' : ribbon.kind === 'spend' ? 'Spending' : 'Unlinked account',
        color: ribbonColor(ribbon, outside ? sideMeta(outside) : { label: '', color: colors.textMuted }),
        amount: ribbon.amount,
        items: itemsFor(ribbon.itemIds),
      })
    },
    [sideById, nameOf, sideMeta, itemsFor],
  )
  const openLane = useCallback(
    (lane: Lane) => {
      setSelection({
        title: `${nameOf(lane.from)} → ${nameOf(lane.to)}`,
        subtitle: flowKindLabels[lane.kind],
        color: laneColor(lane),
        amount: lane.amount,
        items: itemsFor(lane.itemIds),
      })
    },
    [nameOf, itemsFor],
  )
  const openSide = useCallback(
    (node: SideNode) => {
      const ribbons = flow.ribbons.filter((r) => r.from === node.id || r.to === node.id)
      const meta = sideMeta(node)
      setSelection({
        title: meta.label,
        subtitle: monthLabel(month),
        color: meta.color,
        amount: ribbons.reduce((sum, r) => sum + r.amount, 0),
        items: itemsFor(ribbons.flatMap((r) => r.itemIds)),
      })
    },
    [flow.ribbons, sideMeta, itemsFor, month],
  )

  const openCard = useCallback(
    (card: AccountCard) => {
      const edges = graph.edges.filter((edge) => edge.from === card.id || edge.to === card.id)
      const moneyIn = edges.filter((edge) => edge.to === card.id).reduce((sum, edge) => sum + edge.amount, 0)
      const moneyOut = edges.filter((edge) => edge.from === card.id).reduce((sum, edge) => sum + edge.amount, 0)
      const net = round2(moneyIn - moneyOut)
      // Only this account's own rows. A transfer edge carries both legs, and listing the other
      // account's leg here made it look like a transaction on this account.
      const own = itemsFor(edges.flatMap((edge) => edge.itemIds)).filter((item) =>
        card.accountId == null ? item.source === 'manual' : item.accountId === card.accountId,
      )
      const money = (amount: number) => formatMaskableAmount(amount, isMasked)
      setSelection({
        title: card.name,
        subtitle: `${net >= 0 ? 'Up' : 'Down'} this month · in ${money(moneyIn)} · out ${money(moneyOut)}`,
        color: roleColors[card.role],
        amount: Math.abs(net),
        items: own,
      })
    },
    [graph.edges, itemsFor, isMasked],
  )

  const header = (
    <View className="flex-row items-center">
      <View className="flex-1 flex-row">
        <Pressable onPress={() => router.navigate('/(tabs)')} hitSlop={10} accessibilityLabel="Back">
          <Ionicons name="chevron-back" size={24} color={colors.textPrimary} />
        </Pressable>
      </View>
      <MonthNavigator month={month} onPrevious={() => setMonth(shiftMonth(month, -1))} onNext={() => setMonth(shiftMonth(month, 1))} onSelect={setMonth} />
      <View className="flex-1" />
    </View>
  )

  if (isLoading) return <LoadingScreen />

  const hasAccounts = (accounts.data?.length ?? 0) > 0 || feed.some((item) => item.source === 'manual')
  if (!hasAccounts) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }} edges={['top']}>
        <View className="px-5 pt-4">{header}</View>
        <EmptyState message="Link an account in Settings to see your cash flow here." />
      </SafeAreaView>
    )
  }

  const { headline } = graph

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }} edges={['top']}>
      <ScrollView contentContainerClassName="gap-5 px-5 py-4" refreshControl={refreshControl}>
        {header}
        {error ? <ErrorBanner message="Something went wrong loading your data." /> : null}

        <CashFlowHeadline headline={headline} isMasked={isMasked} />

        <View className="gap-3">
          <Text className="font-sansSemi text-base text-textPrimary">Cash flow</Text>
          {flow.ribbons.length === 0 && flow.lanes.length === 0 ? (
            <View className="items-center rounded-xl bg-surface py-8">
              <Text className="font-sans text-sm text-textMuted">No money moved in {monthLabel(month)}.</Text>
            </View>
          ) : (
            <View className="gap-3 rounded-xl bg-surface p-3">
              <View className="flex-row justify-between">
                <View>
                  <Text className="font-sans text-xs text-textSecondary">Income</Text>
                  <Text className="font-mono text-sm" style={{ color: colors.income }}>{formatMaskableAmount(headline.income, isMasked)}</Text>
                </View>
                <View className="items-center">
                  <Text className="font-sans text-xs text-textSecondary">Net</Text>
                  <Text className="font-mono text-sm text-textPrimary">{signed(headline.net, isMasked)}</Text>
                </View>
                <View className="items-end">
                  <Text className="font-sans text-xs text-textSecondary">Spending</Text>
                  <Text className="font-mono text-sm" style={{ color: colors.expense }}>{formatMaskableAmount(headline.spending, isMasked)}</Text>
                </View>
              </View>

              <HouseholdFlowChart
                flow={flow}
                sideMeta={sideMeta}
                cardName={cardName}
                glyphFor={glyphFor}
                isMasked={isMasked}
                onSidePress={openSide}
                onCardPress={openCard}
                onRibbonPress={openRibbon}
                onLanePress={openLane}
              />
            </View>
          )}
        </View>
      </ScrollView>

      <FlowTransactionsSheet
        selection={selection}
        categoryFor={categoryFor}
        isMasked={isMasked}
        accountName={accountName}
        onClose={() => setSelection(null)}
      />
    </SafeAreaView>
  )
}
