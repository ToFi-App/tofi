import type { FeedItem } from '@/lib/transactions/resolveFeed'
import { countsTowardTotals } from '@/lib/transactions/totals'
import { filterByMonth, type YearMonth } from '@/lib/transactions/filterByMonth'
import { UNCATEGORIZED_ID } from '@/lib/transactions/visualizationData'
import { isLiabilityAccount } from '@/lib/accounts/accountType'
import { computeCashOnHand, round2 } from '@/lib/accounts/netWorth'
import { accountRole, type AccountRole } from './accountRole'

/**
 * The month's money as a graph: every account is a node, income and spending are the two outside
 * nodes money enters and leaves through, and every transfer between the user's own accounts is an
 * edge between two account nodes.
 *
 * Two properties are load-bearing and everything below is arranged to keep them:
 *
 *  1. Income and spending equal aggregateMonth's totalIncome/totalExpense for the same month. Both
 *     are decided row by row by countsTowardTotals and netAmount, exactly as aggregateMonth does,
 *     so this screen can never disagree with Home about how much came in or went out.
 *  2. income - spending = saved + invested + debtPaid + checkingChange + unlinked. Every edge is
 *     booked out of one node and into another, so money only ever appears or disappears at the
 *     income and spending nodes. That is what lets the headline show its own arithmetic.
 */

export const CASH_ON_HAND_NODE = 'account:__cash_on_hand__'
export const UNLINKED_NODE = 'unlinked'
/** Where repayments of reimbursed expenses come from. */
export const PAID_BACK_NODE = 'paidBack'

export type FlowNodeKind = 'income' | 'account' | 'unlinked' | 'spend' | 'paidBack'

export interface FlowNode {
  id: string
  kind: FlowNodeKind
  /** Category the node stands for — income and spend nodes only. UNCATEGORIZED_ID when none. */
  categoryId?: string
  /** Account nodes only. Null for cash on hand, which is the manual-transaction wallet. */
  accountId?: string | null
  role?: AccountRole
  /** Account nodes only: the account's display name. Category names are resolved by the UI. */
  label?: string
}

/**
 * What an edge means to the user. Transfers are named by where the money went, so a card payment
 * reads as debt paid down rather than as spending — the spending already happened on the card.
 */
export type FlowKind =
  | 'income'
  | 'spend'
  | 'saved'
  | 'invested'
  | 'debtPaid'
  | 'moved'
  | 'unlinked'
  /**
   * The reimbursed part of an expense whose repayment landed in a DIFFERENT account. It still went
   * to the merchant, so it runs to the expense's spending category — but as its own kind, so the
   * headline's spending stays net of reimbursements and matches Home.
   */
  | 'covered'
  /** A reimbursement arriving in the account that received it. */
  | 'paidBack'

export interface FlowEdge {
  id: string
  from: string
  to: string
  kind: FlowKind
  /** Always positive; direction is carried by from/to. */
  amount: number
  /** Feed ids of every row behind this edge, both legs of each transfer included. */
  itemIds: string[]
}

export interface CashFlowHeadline {
  income: number
  spending: number
  /** income - spending. */
  net: number
  /** Net change across savings accounts from the month's flows. Negative when savings were drawn down. */
  saved: number
  invested: number
  /** Reduction in what's owed on cards and loans. Negative when debt grew. */
  debtPaid: number
  /** Net change across checking accounts and cash on hand. */
  checkingChange: number
  /** Net money sent to accounts the app can't see. */
  unlinked: number
  /** net / income, null when there was no income to divide by. */
  savingsRate: number | null
}

export type AttentionReason = 'unpairedTransfer' | 'unlinkedCardPayment' | 'unmatchedMovement'

export interface AttentionItem {
  itemId: string
  reason: AttentionReason
}

/**
 * One account's month as a statement. start/end are back-cast from today's balance by the same
 * walk the net worth history uses, so they are not independent evidence — but `notCharted` is a
 * real consistency check: it is the part of the account's movement that no edge in the graph
 * accounts for (sweeps, pending rows, a transfer whose other leg was booked in another month).
 */
export interface AccountStatement {
  nodeId: string
  accountId: string | null
  name: string
  role: AccountRole
  /** Balances below are amounts OWED for a liability, so they read the way the bank shows them. */
  isLiability: boolean
  /**
   * Investment accounts: market movement never appears in the ledger, so a back-cast balance would
   * be fiction. Only the flows are shown.
   */
  flowsOnly: boolean
  start: number | null
  end: number | null
  /** Money that raised the account's value (a deposit; a payment onto a card). */
  moneyIn: number
  /** Money that lowered it (a withdrawal or purchase; a charge on a card). */
  moneyOut: number
  notCharted: number
}

export interface CashFlowGraph {
  nodes: FlowNode[]
  edges: FlowEdge[]
  headline: CashFlowHeadline
  statements: AccountStatement[]
  attention: AttentionItem[]
  pendingCount: number
}

/** The subset of an account this needs — structural so FinanceKit accounts qualify too. */
export interface FlowAccount {
  account_id: string
  name: string
  type: string
  subtype?: string | null
  balances?: { current?: number | null } | null
}

const CARD_PAYMENT_PFC = 'LOAN_PAYMENTS_CREDIT_CARD_PAYMENT'

function accountNodeId(accountId: string | null): string {
  return accountId ? `account:${accountId}` : CASH_ON_HAND_NODE
}

function flowKind(from: AccountRole, to: AccountRole): FlowKind {
  if (to === 'debt' && from !== 'debt') return 'debtPaid'
  if (to === 'invested' && from !== 'invested') return 'invested'
  if (to === 'savings' && from === 'spending') return 'saved'
  return 'moved'
}

function monthPrefix({ year, month }: YearMonth): string {
  return `${year}-${String(month).padStart(2, '0')}`
}

export function buildFlowGraph(input: { feed: FeedItem[]; accounts: FlowAccount[]; month: YearMonth }): CashFlowGraph {
  const { feed, accounts, month } = input
  const accountById = new Map(accounts.map((account) => [account.account_id, account]))
  const feedById = new Map(feed.map((item) => [item.id, item]))

  const nodes = new Map<string, FlowNode>()
  function accountNode(accountId: string | null): FlowNode {
    const id = accountNodeId(accountId)
    let node = nodes.get(id)
    if (!node) {
      const account = accountId ? accountById.get(accountId) : undefined
      node = {
        id,
        kind: 'account',
        accountId,
        // Cash on hand is money in a wallet — spent from, like checking. An account missing from
        // the list is one whose institution was removed; its rows still count on Home, so they
        // still have to appear here.
        role: account ? accountRole(account) : 'spending',
        label: accountId ? (account?.name ?? 'Removed account') : 'Cash on hand',
      }
      nodes.set(id, node)
    }
    return node
  }
  function categoryNode(kind: 'income' | 'spend', categoryId: string | null): string {
    const resolved = categoryId ?? UNCATEGORIZED_ID
    const id = `${kind}:${resolved}`
    if (!nodes.has(id)) nodes.set(id, { id, kind, categoryId: resolved })
    return id
  }

  // Income, spending and reimbursement edges only ever run one way, so they accumulate directly.
  const categoryEdges = new Map<string, FlowEdge>()
  function addCategoryEdge(from: string, to: string, kind: 'income' | 'spend' | 'covered' | 'paidBack', amount: number, itemId: string) {
    // Keyed by kind as well: a spend edge and a covered edge share both ends (account -> category).
    const id = `${from}->${to}:${kind}`
    const edge = categoryEdges.get(id) ?? { id, from, to, kind, amount: 0, itemIds: [] }
    edge.amount += amount
    edge.itemIds.push(itemId)
    categoryEdges.set(id, edge)
  }

  // Account-to-account movement is kept gross per direction: $500 to savings and $200 back are
  // two edges, not one $300 edge. The per-account view exists to show what went in AND what came
  // out; netting would hide exactly that. The headline still nets, by summing edges per role.
  const accountEdges = new Map<string, { from: string; to: string; amount: number; itemIds: string[] }>()
  function addAccountFlow(from: string, to: string, signedAmount: number, itemIds: string[]) {
    if (from === to || signedAmount === 0) return
    // A negative amount is money arriving at `from` — an unpaired inflow — so it runs the other way.
    const [src, dst] = signedAmount > 0 ? [from, to] : [to, from]
    const key = `${src}->${dst}`
    const edge = accountEdges.get(key) ?? { from: src, to: dst, amount: 0, itemIds: [] }
    edge.amount += Math.abs(signedAmount)
    edge.itemIds.push(...itemIds)
    accountEdges.set(key, edge)
  }

  /**
   * The reimbursed part of an expense. Home counts only the net (a $100 dinner with $60 paid back is
   * $40 of spending), and so does the spend edge above. That is also the right picture when the $60
   * came back into the same account: it cancels there, and nothing more is drawn.
   *
   * When it came back into a DIFFERENT account, the full $100 really left the paying account for
   * the merchant and the $60 really arrived elsewhere. Drawing only the net would make both
   * accounts' flows wrong — and an expense reimbursed in full would vanish entirely. So the
   * reimbursed part is added to the category as a "covered" edge, and the repayment arrives from
   * the reimbursements node into the account that received it.
   *
   * Booked in the expense's month, like a transfer in its outflow month, and only as much as the
   * linked repayments cover: that keeps "covered" and "paid back" equal, so they cancel in the
   * headline and never disturb income - spending. Repayment beyond the expense is ignored, exactly
   * as netAmount (floored at zero) ignores it on Home.
   */
  function bookReimbursement(item: FeedItem, paidFrom: string, net: number) {
    let remaining = item.amount - Math.max(net, 0)
    let covered = 0
    for (const link of item.links) {
      if (link.kind !== 'reimbursement' || remaining <= 0) continue
      const portion = Math.min(link.amount, remaining)
      const leg = link.itemId ? feedById.get(link.itemId) : undefined
      // A repayment outside the synced window has no account to land in; the paying account is the
      // best stand-in, since the money did come back to the user.
      const receivedIn = leg ? accountNode(leg.source === 'manual' ? null : leg.accountId).id : paidFrom
      remaining -= portion
      if (receivedIn === paidFrom) continue
      if (!nodes.has(PAID_BACK_NODE)) nodes.set(PAID_BACK_NODE, { id: PAID_BACK_NODE, kind: 'paidBack', label: 'Reimbursements' })
      addCategoryEdge(PAID_BACK_NODE, receivedIn, 'paidBack', portion, leg?.id ?? item.id)
      covered += portion
    }
    if (covered > 0) addCategoryEdge(paidFrom, categoryNode('spend', item.categoryId), 'covered', covered, item.id)
  }

  const attention: AttentionItem[] = []
  let pendingCount = 0

  for (const item of filterByMonth(feed, month)) {
    if (item.pending) {
      pendingCount += 1
      continue
    }
    // Already netted out of its expense via netAmount, exactly as aggregateMonth skips it.
    if (item.isReimbursementIncome) continue

    if (countsTowardTotals(item)) {
      const net = item.netAmount ?? item.amount
      const node = accountNode(item.accountId).id
      if (net > 0) {
        addCategoryEdge(node, categoryNode('spend', item.categoryId), 'spend', net, item.id)
        // Still counted — with the card unlinked it's the only trace of what was bought on it —
        // but worth surfacing: linking the card would replace it with the real purchases.
        if (item.pfcDetailed === CARD_PAYMENT_PFC) attention.push({ itemId: item.id, reason: 'unlinkedCardPayment' })
      } else if (net < 0) {
        addCategoryEdge(categoryNode('income', item.categoryId), node, 'income', -net, item.id)
      }
      if (item.reimbursedAmount) bookReimbursement(item, node, net)
      continue
    }

    // A sweep mirrors an equal inflow on the same account: money that never left the account.
    if (item.isSweptOutflow) continue

    if (item.transferKind !== null) {
      const counterpartId = item.links[0]?.itemId ?? null
      const counterpart = counterpartId ? feedById.get(counterpartId) : undefined
      const from = accountNode(item.accountId).id
      if (counterpart) {
        // The outflow leg books the pair, in ITS month, so a transfer straddling a month boundary
        // is drawn once rather than half in each month.
        if (item.transferRole === 'income') continue
        addAccountFlow(from, accountNode(counterpart.accountId).id, item.amount, [item.id, counterpart.id])
      } else {
        // Signed, so an unpaired inflow correctly draws as arriving FROM the unlinked node.
        addAccountFlow(from, UNLINKED_NODE, item.amount, [item.id])
        attention.push({ itemId: item.id, reason: 'unpairedTransfer' })
      }
      continue
    }

    // What remains is internal movement recognized by PFC on a brokerage cash account. With an
    // equal counterpart on another account it crossed an account boundary that no transfer record
    // captures yet; without one it moved between the account's cash and its holdings, which is
    // not a flow between accounts at all.
    if (item.hasCrossAccountCounterpart) {
      addAccountFlow(accountNode(item.accountId).id, UNLINKED_NODE, item.amount, [item.id])
      attention.push({ itemId: item.id, reason: 'unmatchedMovement' })
    }
  }

  const edges: FlowEdge[] = []
  for (const edge of categoryEdges.values()) {
    edge.amount = round2(edge.amount)
    if (edge.amount > 0) edges.push(edge)
  }
  for (const edge of accountEdges.values()) {
    const amount = round2(edge.amount)
    if (amount === 0) continue
    if (edge.from === UNLINKED_NODE || edge.to === UNLINKED_NODE) {
      nodes.set(UNLINKED_NODE, { id: UNLINKED_NODE, kind: 'unlinked', label: 'Unlinked accounts' })
    }
    const fromRole = nodes.get(edge.from)?.role
    const toRole = nodes.get(edge.to)?.role
    const kind = fromRole && toRole ? flowKind(fromRole, toRole) : 'unlinked'
    edges.push({ id: `${edge.from}->${edge.to}`, from: edge.from, to: edge.to, kind, amount, itemIds: edge.itemIds })
  }

  // Book every edge out of one node and into another. Only account and unlinked nodes hold money,
  // so this is what makes the headline's parts sum to income - spending.
  const netByNode = new Map<string, number>()
  for (const edge of edges) {
    netByNode.set(edge.from, (netByNode.get(edge.from) ?? 0) - edge.amount)
    netByNode.set(edge.to, (netByNode.get(edge.to) ?? 0) + edge.amount)
  }
  const netByRole: Record<AccountRole, number> = { spending: 0, savings: 0, invested: 0, debt: 0 }
  for (const node of nodes.values()) {
    if (node.kind === 'account' && node.role) netByRole[node.role] += netByNode.get(node.id) ?? 0
  }

  const income = round2(edges.filter((e) => e.kind === 'income').reduce((sum, e) => sum + e.amount, 0))
  const spending = round2(edges.filter((e) => e.kind === 'spend').reduce((sum, e) => sum + e.amount, 0))
  const net = round2(income - spending)
  const headline: CashFlowHeadline = {
    income,
    spending,
    net,
    saved: round2(netByRole.savings),
    invested: round2(netByRole.invested),
    debtPaid: round2(netByRole.debt),
    checkingChange: round2(netByRole.spending),
    unlinked: round2(netByNode.get(UNLINKED_NODE) ?? 0),
    savingsRate: income > 0 ? net / income : null,
  }

  return {
    nodes: [...nodes.values()],
    edges,
    headline,
    statements: buildStatements(feed, accounts, month, netByNode),
    attention,
    pendingCount,
  }
}

const ROLE_ORDER: AccountRole[] = ['spending', 'savings', 'invested', 'debt']

function buildStatements(
  feed: FeedItem[],
  accounts: FlowAccount[],
  month: YearMonth,
  chartedNetByNode: Map<string, number>,
): AccountStatement[] {
  const prefix = monthPrefix(month)

  // Per node: value change after the month, and in/out within it. Value, not balance: a charge
  // lowers a card's value (raises what's owed), so one sign convention covers both account kinds.
  // Every row counts here, excluded and pending ones included — they all moved the balance, which
  // is exactly the walk computeNetWorthHistory does.
  const after = new Map<string, number>()
  const moneyIn = new Map<string, number>()
  const moneyOut = new Map<string, number>()
  let hasManual = false
  for (const item of feed) {
    if (item.source === 'manual') hasManual = true
    const node = accountNodeId(item.source === 'manual' ? null : item.accountId)
    const itemMonth = item.date.slice(0, 7)
    if (itemMonth > prefix) {
      after.set(node, (after.get(node) ?? 0) - item.amount)
    } else if (itemMonth === prefix) {
      if (item.amount < 0) moneyIn.set(node, (moneyIn.get(node) ?? 0) - item.amount)
      else moneyOut.set(node, (moneyOut.get(node) ?? 0) + item.amount)
    }
  }

  function statement(
    nodeId: string,
    accountId: string | null,
    name: string,
    role: AccountRole,
    isLiability: boolean,
    valueNow: number,
  ): AccountStatement {
    const inflow = round2(moneyIn.get(nodeId) ?? 0)
    const outflow = round2(moneyOut.get(nodeId) ?? 0)
    const endValue = valueNow - (after.get(nodeId) ?? 0)
    const startValue = endValue - (inflow - outflow)
    const flowsOnly = role === 'invested'
    // Owed amounts read positive, the way the card's own app shows them.
    const display = (value: number) => round2(isLiability ? -value : value)
    return {
      nodeId,
      accountId,
      name,
      role,
      isLiability,
      flowsOnly,
      start: flowsOnly ? null : display(startValue),
      end: flowsOnly ? null : display(endValue),
      moneyIn: inflow,
      moneyOut: outflow,
      notCharted: round2(inflow - outflow - (chartedNetByNode.get(nodeId) ?? 0)),
    }
  }

  const statements = accounts.map((account) => {
    const isLiability = isLiabilityAccount(account)
    const current = account.balances?.current ?? 0
    return statement(
      accountNodeId(account.account_id),
      account.account_id,
      account.name,
      accountRole(account),
      isLiability,
      isLiability ? -current : current,
    )
  })
  if (hasManual) {
    statements.push(statement(CASH_ON_HAND_NODE, null, 'Cash on hand', 'spending', false, computeCashOnHand(feed)))
  }

  // Stable within a role, so accounts keep the user's own ordering from useAccounts.
  return statements
    .map((s, index) => ({ s, index }))
    .sort((x, y) => ROLE_ORDER.indexOf(x.s.role) - ROLE_ORDER.indexOf(y.s.role) || x.index - y.index)
    .map(({ s }) => s)
}
