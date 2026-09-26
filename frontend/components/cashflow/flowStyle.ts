import { colors, flowColors } from '@/constants/theme'
import type { AccountRole } from '@/lib/cashflow/accountRole'
import type { FlowKind, FlowNode } from '@/lib/cashflow/buildFlowGraph'
import type { Lane, Ribbon, SideNode } from '@/lib/cashflow/householdFlow'
import { UNCATEGORIZED_COLOR, UNCATEGORIZED_ID, UNCATEGORIZED_NAME } from '@/lib/transactions/visualizationData'
import type { Category } from '@/types/domain'

export const roleColors: Record<AccountRole, string> = {
  spending: colors.transfer,
  savings: flowColors.saved,
  invested: flowColors.invested,
  debt: flowColors.debtPaid,
}

export const roleLabels: Record<AccountRole, string> = {
  spending: 'Checking',
  savings: 'Savings',
  invested: 'Investment',
  debt: 'Credit & loans',
}

export const flowKindLabels: Record<FlowKind, string> = {
  income: 'Income',
  spend: 'Spending',
  saved: 'Saved',
  invested: 'Invested',
  debtPaid: 'Debt paid down',
  moved: 'Moved',
  unlinked: 'Unlinked account',
  covered: 'Spending (reimbursed)',
  paidBack: 'Reimbursements',
}

export interface NodeMeta {
  label: string
  color: string
}

/** Label and color for any node, so the chart, its sheets and the lists all name a node the same way. */
export function nodeMeta(node: FlowNode, categoryById: Map<string, Category>): NodeMeta {
  if (node.kind === 'account') {
    return { label: node.label ?? 'Account', color: node.role ? roleColors[node.role] : colors.transfer }
  }
  if (node.kind === 'unlinked') return { label: node.label ?? 'Unlinked accounts', color: flowColors.unlinked }

  const color = node.kind === 'income' ? flowColors.income : UNCATEGORIZED_COLOR
  if (!node.categoryId || node.categoryId === UNCATEGORIZED_ID) return { label: UNCATEGORIZED_NAME, color }
  const category = categoryById.get(node.categoryId)
  return {
    label: category?.name ?? UNCATEGORIZED_NAME,
    // Income nodes share one color: the income column reads as "money arriving", and category tints
    // there would compete with the spending column that actually needs them.
    color: node.kind === 'income' ? flowColors.income : (category?.color ?? UNCATEGORIZED_COLOR),
  }
}

/** Label and color for a row on the left (income) or right (spending) edge of the household chart. */
export function sideNodeMeta(node: SideNode, graphNodeById: Map<string, FlowNode>, categoryById: Map<string, Category>): NodeMeta {
  switch (node.kind) {
    case 'otherIncome':
      return { label: 'Other income', color: flowColors.income }
    case 'otherSpend':
      return { label: 'Other spending', color: colors.textMuted }
    case 'fromUnlinked':
      return { label: 'From unlinked accounts', color: flowColors.unlinked }
    case 'toUnlinked':
      return { label: 'To unlinked accounts', color: flowColors.unlinked }
    case 'paidBack':
      return { label: 'Reimbursements', color: colors.reimbursed }
    case 'income':
    case 'spend': {
      const underlying = node.graphNodeId ? graphNodeById.get(node.graphNodeId) : undefined
      return underlying ? nodeMeta(underlying, categoryById) : { label: 'Unknown', color: colors.textMuted }
    }
  }
}

/** Ribbons take the color of their outside end: green arriving as income, the category's own going out. */
export function ribbonColor(ribbon: Ribbon, outsideMeta: NodeMeta): string {
  if (ribbon.kind === 'income') return flowColors.income
  if (ribbon.kind === 'unlinked') return flowColors.unlinked
  if (ribbon.kind === 'reimbursement') return colors.reimbursed
  return outsideMeta.color
}

/** Lanes are colored by what the transfer did: saved, invested, debt paid down, or just moved. */
export function laneColor(lane: Lane): string {
  switch (lane.kind) {
    case 'saved':
      return flowColors.saved
    case 'invested':
      return flowColors.invested
    case 'debtPaid':
      return flowColors.debtPaid
    default:
      return flowColors.moved
  }
}
