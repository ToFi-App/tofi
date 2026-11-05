import { useCallback, useMemo, useState } from 'react'
import { Text, View } from 'react-native'
import { colors, spacing } from '@/constants/theme'
import { useAmountsMasked } from '@/hooks/useAmountsMasked'
import { CashFlowHeadline } from '@/components/cashflow/CashFlowHeadline'
import { HouseholdFlowChart } from '@/components/cashflow/HouseholdFlowChart'
import { accountFallbackIcon, variantIcons } from '@/components/accounts/AccountRow'
import { FlowTransactionsSheet, type FlowSelection } from '@/components/cashflow/FlowTransactionsSheet'
import { flowKindLabels, laneColor, ribbonColor, roleColors, sideNodeMeta } from '@/components/cashflow/flowStyle'
import { buildFlowGraph } from '@/lib/cashflow/buildFlowGraph'
import { buildHouseholdFlow, type AccountCard, type Lane, type Ribbon, type SideNode } from '@/lib/cashflow/householdFlow'
import { formatMaskableAmount } from '@/lib/format/money'
import { round2 } from '@/lib/accounts/netWorth'
import { monthLabel, type YearMonth } from '@/lib/transactions/filterByMonth'
import type { FeedItem } from '@/lib/transactions/resolveFeed'
import type { Account, Category } from '@/types/domain'

const MAX_INCOME_ROWS = 4
const MAX_SPEND_ROWS = 6
/** The diagram's gap from the screen's edges: just enough that its cards don't touch the glass. */
const DIAGRAM_SIDE_MARGIN = 3

function byDateDesc(a: FeedItem, b: FeedItem): number {
  return b.date.localeCompare(a.date)
}

const RIBBON_SUBTITLES: Record<Ribbon['kind'], string> = {
  income: 'Income',
  spend: 'Spending',
  unlinked: 'Unlinked account',
  reimbursement: '',
}

interface CashFlowViewProps {
  month: YearMonth
  /** The whole feed, every account: see below. */
  feed: FeedItem[]
  categoryById: Map<string, Category>
  accounts: Account[]
}

/**
 * Where the month's money came from and went — the second page of Home's Charts. The chart looks at
 * one subject at a time — the household, or a single account — with its inflows on the left and
 * outflows on the right, which is what makes the flow between accounts readable: pick Checking and
 * every transfer in and out of it is a row of its own. Tapping a flow lists its transactions.
 *
 * Always all accounts: Home's account filter doesn't apply here, because a transfer only makes
 * sense with both ends in view.
 */
export function CashFlowView({ month, feed, categoryById, accounts }: CashFlowViewProps) {
  const { isMasked } = useAmountsMasked()
  const [selection, setSelection] = useState<FlowSelection | null>(null)

  const graph = useMemo(() => buildFlowGraph({ feed, accounts, month }), [feed, accounts, month])
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
  const accountById = useMemo(() => new Map(accounts.map((a) => [a.account_id, a])), [accounts])
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
        // A reimbursement ribbon's title already names it ("Reimbursements → …"), so it takes no
        // subtitle — it used to fall through to "Unlinked account", which it isn't.
        subtitle: RIBBON_SUBTITLES[ribbon.kind],
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

  const hasAccounts = accounts.length > 0 || feed.some((item) => item.source === 'manual')
  if (!hasAccounts) {
    return (
      <View className="items-center py-12">
        <Text className="font-sans text-sm text-textMuted">Link an account in Settings to see your cash flow here.</Text>
      </View>
    )
  }

  const { headline } = graph

  return (
    <View className="gap-5">
      <CashFlowHeadline headline={headline} isMasked={isMasked} />

      <View>
        {flow.ribbons.length === 0 && flow.lanes.length === 0 ? (
          <View className="items-center rounded-xl bg-surface py-8">
            <Text className="font-sans text-sm text-textMuted">No money moved in {monthLabel(month)}.</Text>
          </View>
        ) : (
          // Nearly edge to edge with no card round it: the negative margin cancels all but a sliver
          // of the page's side padding, so the diagram gets almost the whole width to spread across.
          <View style={{ marginHorizontal: -(spacing[5] - DIAGRAM_SIDE_MARGIN) }}>
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

      <FlowTransactionsSheet
        selection={selection}
        categoryFor={categoryFor}
        isMasked={isMasked}
        accountName={accountName}
        onClose={() => setSelection(null)}
      />
    </View>
  )
}
