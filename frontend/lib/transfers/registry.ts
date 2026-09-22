import type { Ionicons } from '@expo/vector-icons'
import { colors } from '@/constants/theme'
import { isLiabilityAccount } from '@/lib/accounts/accountType'
import type { FeedItem } from '@/lib/transactions/resolveFeed'
import type { Account, TransferKind } from '@/types/domain'

export interface TransferContext {
  accounts: Account[]
}

export interface TransferTypeDefinition {
  kind: TransferKind
  label: string
  /** Compact badge text for tight rows (TransactionRow); `label` stays for sheets/cards. */
  shortLabel: string
  icon: keyof typeof Ionicons.glyphMap
  color: string
  appliesTo(item: FeedItem, ctx: TransferContext): boolean
  matches(item: FeedItem, candidate: FeedItem, ctx: TransferContext): boolean
  allowsUnpaired: boolean
  multiSelect?: boolean
}

/** Whole days between two YYYY-MM-DD calendar keys, parsed as UTC so DST never shifts the count. */
export function daysBetween(a: string, b: string): number {
  const MS_PER_DAY = 24 * 60 * 60 * 1000
  return Math.abs(Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / MS_PER_DAY
}

export function amountWithinTolerance(pct: number) {
  return (a: FeedItem, b: FeedItem): boolean =>
    Math.abs(Math.abs(a.amount) - Math.abs(b.amount)) <= Math.abs(a.amount) * pct
}

export function exactAmount(a: FeedItem, b: FeedItem): boolean {
  return Math.abs(a.amount) === Math.abs(b.amount)
}

export function withinDays(days: number) {
  return (a: FeedItem, b: FeedItem): boolean => daysBetween(a.postedDate, b.postedDate) <= days
}

export function differentAccount(a: FeedItem, b: FeedItem): boolean {
  if (a.accountId === null || b.accountId === null) return true
  return a.accountId !== b.accountId
}

function isExpense(item: FeedItem): boolean {
  return item.amount > 0
}

function itemOnLiabilityAccount(item: FeedItem, ctx: TransferContext): boolean {
  if (item.accountId === null) return false
  const account = ctx.accounts.find((a) => a.account_id === item.accountId)
  return account ? isLiabilityAccount(account) : false
}

function isOppositeSign(item: FeedItem, candidate: FeedItem): boolean {
  return (item.amount > 0 && candidate.amount < 0) || (item.amount < 0 && candidate.amount > 0)
}

const withinWeek = withinDays(7)
const withinMonth = withinDays(30)
const within5Pct = amountWithinTolerance(0.05)

export const TRANSFER_TYPES: Record<TransferKind, TransferTypeDefinition> = {
  account_transfer: {
    kind: 'account_transfer',
    label: 'Between accounts',
    shortLabel: 'Transfer',
    icon: 'swap-horizontal',
    color: colors.primary,
    appliesTo: () => true,
    matches: (item, candidate) =>
      isOppositeSign(item, candidate) &&
      candidate.id !== item.id &&
      within5Pct(item, candidate) &&
      withinWeek(item, candidate) &&
      differentAccount(item, candidate),
    allowsUnpaired: true,
  },
  credit_card_payment: {
    kind: 'credit_card_payment',
    label: 'Credit card payment',
    shortLabel: 'Payment',
    icon: 'card-outline',
    color: colors.transfer,
    appliesTo: (item, ctx) => {
      if (isExpense(item)) return true
      return itemOnLiabilityAccount(item, ctx)
    },
    matches: (item, candidate, ctx) => {
      if (!isOppositeSign(item, candidate) || candidate.id === item.id) return false
      if (!exactAmount(item, candidate) || !withinWeek(item, candidate) || !differentAccount(item, candidate)) return false
      if (isExpense(item)) return itemOnLiabilityAccount(candidate, ctx)
      return true
    },
    allowsUnpaired: true,
  },
  refund: {
    kind: 'refund',
    label: 'Refund',
    shortLabel: 'Refund',
    icon: 'arrow-undo-outline',
    color: '#D97706',
    appliesTo: () => true,
    matches: (item, candidate) =>
      isOppositeSign(item, candidate) &&
      candidate.id !== item.id &&
      exactAmount(item, candidate) &&
      withinMonth(item, candidate),
    allowsUnpaired: true,
  },
  reimbursement: {
    kind: 'reimbursement',
    label: 'Reimbursement',
    shortLabel: 'Reimbursed',
    icon: 'arrow-undo',
    color: colors.reimbursed,
    // Entered from the income side: you mark the money that came back, then pick the expense it
    // paid you back for. One income pays back one expense — a single income split across several
    // expenses has no defined allocation, so this kind stays single-select.
    appliesTo: (item) => !isExpense(item),
    matches: (item, candidate) =>
      isOppositeSign(item, candidate) &&
      candidate.id !== item.id,
    allowsUnpaired: false,
  },
}

export const TRANSFER_TYPE_LIST: TransferTypeDefinition[] = Object.values(TRANSFER_TYPES)

export function transferTypeLabel(kind: TransferKind): string {
  return TRANSFER_TYPES[kind].label
}
