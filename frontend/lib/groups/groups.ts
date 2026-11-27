// Transaction groups (docs/transaction-groups.md), the parts that are pure functions of the feed:
// which rows may join a group, how a member row maps back to a feed item, a group's totals, and
// what the Calendar tab shows once groups are taken into account.
//
// Kept free of React so it runs under vitest; the screens only render what these return.

import type { FeedItem } from '@/lib/transactions/resolveFeed'
import { isInternalMovement } from '@/lib/transactions/totals'
import { categoryColors } from '@/constants/theme'
import type { TransactionGroup, TransactionGroupMember } from '@/types/domain'

/** The backend's member shape: exactly one of the two ids is set. */
export interface MemberRef {
  plaidTransactionId: string | null
  manualTransactionId: string | null
}

/**
 * Same column split transfers use (buildTransferInputs): manual rows go by their uuid, everything
 * else — Plaid, FinanceKit, investment cash — shares the Plaid id column.
 */
export function memberRefFor(item: FeedItem): MemberRef {
  return item.source === 'manual'
    ? { plaidTransactionId: null, manualTransactionId: item.id }
    : { plaidTransactionId: item.id, manualTransactionId: null }
}

/** The feed id a member row points at. */
export function memberItemId(member: Pick<TransactionGroupMember, 'plaidTransactionId' | 'manualTransactionId'>): string {
  return member.plaidTransactionId ?? member.manualTransactionId ?? ''
}

/**
 * Whether a row may be put in a group. Money moving between the user's own accounts (transfer
 * legs, card payments, sweeps, trades) is neither spending nor income, and grouping it would make
 * the group's totals wrong. Reimbursement incomes and pending rows are fine: a Venmo paying the
 * user back is exactly what a trip group is for.
 */
export function canJoinGroup(item: FeedItem): boolean {
  return !isInternalMovement(item) && !item.isSweptOutflow
}

export interface GroupSummary {
  group: TransactionGroup
  /** Members found in the feed, newest first. A member whose transaction is gone is simply absent. */
  items: FeedItem[]
  /** Money out and in, from each row's own amount. */
  out: number
  in: number
  /** in − out: what the group cost the user (negative) or brought in (positive). */
  net: number
  resolved: boolean
}

/**
 * Totals use each row's RAW amount, never netAmount. A grouped expense whose payback is also
 * linked to it as a reimbursement already has that payback in the group as its own row; netting
 * the expense as well would count the money back twice.
 */
export function summarizeGroup(group: TransactionGroup, groupIdByItem: Map<string, string>, feedById: Map<string, FeedItem>): GroupSummary {
  const items: FeedItem[] = []
  let out = 0
  let income = 0
  for (const [itemId, groupId] of groupIdByItem) {
    if (groupId !== group.id) continue
    const item = feedById.get(itemId)
    if (!item) continue
    items.push(item)
    if (item.amount > 0) out += item.amount
    else income += -item.amount
  }
  items.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0))
  return { group, items, out: round2(out), in: round2(income), net: round2(income - out), resolved: group.resolvedAt !== null }
}

function round2(n: number): number {
  return Math.round(n * 100) / 100
}

/** Feed id → the group it is in, from the stored member rows only. One group per transaction. */
export function groupIdByItemId(members: TransactionGroupMember[]): Map<string, string> {
  const map = new Map<string, string>()
  for (const member of members) map.set(memberItemId(member), member.groupId)
  return map
}

/**
 * Feed id → group, counting what a group really holds: its stored members, plus every payback
 * linked as a reimbursement to one of its member EXPENSES. A Venmo that paid back the Airbnb is
 * part of the trip whether or not the user also added it, and leaving it out had the group charge
 * the full $100.76 while the day header (which nets reimbursements) said $31.50.
 *
 * Derived, never stored: unlinking the reimbursement takes the payback out with it. A payback the
 * user put in another group explicitly stays there. Only expense → income: an ungrouped expense
 * doesn't join a group because a grouped Venmo happens to be linked to it.
 */
export function effectiveGroupIdByItemId(members: TransactionGroupMember[], feedById: Map<string, FeedItem>): Map<string, string> {
  const map = groupIdByItemId(members)
  for (const member of members) {
    const item = feedById.get(memberItemId(member))
    if (!item || item.amount <= 0) continue
    for (const link of item.links) {
      if (link.kind !== 'reimbursement' || !link.itemId || map.has(link.itemId)) continue
      map.set(link.itemId, member.groupId)
    }
  }
  return map
}

/**
 * The Calendar tab's view of the feed: an ACTIVE group's transactions leave the day cards (and so
 * the day totals and shading built from them) until the group is resolved — they live in the
 * Groups card and the group's own sheet meanwhile. A resolved group's transactions are ordinary
 * rows again. Returns the input array itself when nothing is hidden, so memos downstream hold.
 */
export function hideActiveGroupMembers(items: FeedItem[], groups: TransactionGroup[], groupIdByItem: Map<string, string>): FeedItem[] {
  const active = new Set(groups.filter((g) => g.resolvedAt === null).map((g) => g.id))
  if (active.size === 0) return items
  const hidden = new Set<string>()
  for (const [itemId, groupId] of groupIdByItem) if (active.has(groupId)) hidden.add(itemId)
  if (hidden.size === 0) return items
  return items.filter((item) => !hidden.has(item.id))
}

/**
 * A new group's colour, chosen for the user: the first category colour no existing group uses,
 * cycling once they're all taken. Drawn from the category palette so a group pill sits in the
 * same family as the category icons beside it, without claiming a semantic colour.
 */
const GROUP_PALETTE: readonly string[] = [
  categoryColors.travel,
  categoryColors.foodAndDrink,
  categoryColors.transport,
  categoryColors.entertainment,
  categoryColors.services,
  categoryColors.home,
  categoryColors.shopping,
  categoryColors.personalCare,
]

export function nextGroupColor(groups: TransactionGroup[]): string {
  const used = new Set(groups.map((g) => g.color.toUpperCase()))
  return GROUP_PALETTE.find((c) => !used.has(c.toUpperCase())) ?? GROUP_PALETTE[groups.length % GROUP_PALETTE.length]
}

/**
 * The add-transactions picker's list: eligible rows not already in THIS group, newest first,
 * narrowed by a search over the name the row shows (note or merchant), its raw Plaid name, and its
 * amount ("84" finds −$84.00). Rows in another group stay in the list — the picker shows them
 * dimmed with that group's name — so `otherGroupId` tells the caller which those are.
 */
export interface PickerCandidate {
  item: FeedItem
  otherGroupId: string | null
}

export function pickerCandidates(feed: FeedItem[], groupId: string, byItem: Map<string, string>, query: string): PickerCandidate[] {
  const q = query.trim().toLowerCase()
  const out: PickerCandidate[] = []
  for (const item of feed) {
    if (!canJoinGroup(item)) continue
    const inGroup = byItem.get(item.id) ?? null
    if (inGroup === groupId) continue
    if (q && !matchesQuery(item, q)) continue
    out.push({ item, otherGroupId: inGroup })
  }
  out.sort((a, b) => (a.item.date < b.item.date ? 1 : a.item.date > b.item.date ? -1 : 0))
  return out
}

function matchesQuery(item: FeedItem, q: string): boolean {
  const haystack = [item.note, item.merchantName, item.plaidName].filter(Boolean).join(' ').toLowerCase()
  if (haystack.includes(q)) return true
  const digits = q.replace(/[$,\s]/g, '')
  return digits.length > 0 && /^[0-9.]+$/.test(digits) && Math.abs(item.amount).toFixed(2).includes(digits)
}

/** "1 transaction", "7 transactions". */
export function transactionCountLabel(count: number): string {
  return `${count} ${count === 1 ? 'transaction' : 'transactions'}`
}
