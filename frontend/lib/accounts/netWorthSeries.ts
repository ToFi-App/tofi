import { CASH_ON_HAND_KEY } from './composition'
import { computeCashOnHand, isInvestmentAccount, isLiabilityAccount } from './netWorth'
import type { Account } from '@/types/domain'
import type { FeedItem } from '@/lib/transactions/resolveFeed'
import type { AccountMonthPoint } from './netWorthHistory'

export type NetWorthSeriesGroup = 'investment' | 'cash' | 'liability'

/** One account's band in the stacked net worth bars. */
export interface NetWorthSeries {
  key: string
  label: string
  group: NetWorthSeriesGroup
  logo: string | null
  /** Read only to spot Apple accounts, which take the Apple mark instead of a generic glyph. */
  itemId: string | null
  /** Position inside its group, 0 = largest today. Drives the stepped tint. */
  indexInGroup: number
}

const GROUP_ORDER: NetWorthSeriesGroup[] = ['cash', 'investment', 'liability']

/**
 * Every account the net worth bars draw, in stacking order, with today's signed balance as the
 * anchor computeAccountHistory walks back from.
 *
 * The order is fixed from TODAY and reused for every month, so an account holds the same place
 * in every bar and can be followed across the chart. Cash sits on the zero line, investments on
 * top of it, debt below zero; inside a group the largest balance is nearest the zero line.
 *
 * Signed as net worth counts them: a card's $400 owed anchors at -400. Zero-balance accounts are
 * kept — a card paid off today still had a balance in earlier months — and the chart simply draws
 * nothing for a month where the balance is zero. Cash on hand joins only once a manual entry
 * exists, matching the composition map.
 */
export function buildNetWorthSeries(
  accounts: Account[],
  feed: FeedItem[],
): { series: NetWorthSeries[]; anchors: Map<string, number> } {
  const byGroup: Record<NetWorthSeriesGroup, Array<Omit<NetWorthSeries, 'indexInGroup'> & { value: number }>> = {
    investment: [],
    cash: [],
    liability: [],
  }

  for (const account of accounts) {
    const balance = account.balances?.current ?? 0
    const group: NetWorthSeriesGroup = isLiabilityAccount(account)
      ? 'liability'
      : isInvestmentAccount(account)
        ? 'investment'
        : 'cash'
    byGroup[group].push({
      key: account.account_id,
      label: account.name,
      group,
      logo: account.institutionLogo || null,
      itemId: account.itemId ?? null,
      value: group === 'liability' ? -balance : balance,
    })
  }

  if (feed.some((item) => item.source === 'manual')) {
    byGroup.cash.push({
      key: CASH_ON_HAND_KEY,
      label: 'Cash',
      group: 'cash',
      logo: null,
      itemId: null,
      value: computeCashOnHand(feed),
    })
  }

  const series: NetWorthSeries[] = []
  const anchors = new Map<string, number>()
  for (const group of GROUP_ORDER) {
    const members = [...byGroup[group]].sort((a, b) => Math.abs(b.value) - Math.abs(a.value))
    members.forEach(({ value, ...entry }, indexInGroup) => {
      series.push({ ...entry, indexInGroup })
      anchors.set(entry.key, value)
    })
  }
  return { series, anchors }
}

/** A single bar segment, in value space: `from` is the end nearer zero. */
export interface StackSegment {
  key: string
  from: number
  to: number
}

/**
 * Stacks one month's balances in series order: positive balances upward from zero, negative ones
 * downward. Debt is always negative, but an overdrawn checking account is too, and it belongs
 * below the line with the debt rather than cancelling out part of the bar above it.
 */
export function stackMonth(series: NetWorthSeries[], balances: Map<string, number>): StackSegment[] {
  let up = 0
  let down = 0
  const segments: StackSegment[] = []
  for (const { key } of series) {
    const value = balances.get(key) ?? 0
    if (value > 0) {
      segments.push({ key, from: up, to: up + value })
      up += value
    } else if (value < 0) {
      segments.push({ key, from: down, to: down + value })
      down += value
    }
  }
  return segments
}

/**
 * Each balance as the period OPENED — the start of its first month, not the end. That is the
 * baseline a change "in 2026" is measured from, and where the dotted reference lines sit: the
 * first month's own movement belongs to the period, so it has to be undone rather than skipped.
 */
export function periodStart(months: Pick<AccountMonthPoint, 'balances' | 'flow'>[]): Map<string, number> {
  const start = new Map<string, number>()
  if (months.length === 0) return start
  const [first] = months
  for (const [key, value] of first.balances) {
    start.set(key, Math.round((value + (first.flow.get(key) ?? 0)) * 100) / 100)
  }
  return start
}
