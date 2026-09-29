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

/**
 * The sign a real balance must have, per series — see computeAccountHistory's `expectedSign`. Cash
 * accounts can't sit below zero and debt can't sit in credit, so a leftover of the wrong sign before
 * an account's first transaction means it didn't exist yet. Investments (their leftover is real
 * market growth) and the manual cash pot (negative is meaningful there) are left out on purpose.
 */
export function expectedSignFor(series: NetWorthSeries[]): Map<string, 1 | -1> {
  const signs = new Map<string, 1 | -1>()
  for (const s of series) {
    if (s.key === CASH_ON_HAND_KEY || s.group === 'investment') continue
    signs.set(s.key, s.group === 'liability' ? -1 : 1)
  }
  return signs
}

/**
 * How much each account moved during one point — its close minus its open, signed as net worth
 * counts it, so a card balance rising is negative. Accounts that didn't move are left out. These
 * are what the chart's bars stack: gains up from zero, losses down.
 */
export function periodChanges(point: Pick<AccountMonthPoint, 'balances' | 'startBalances'>): Map<string, number> {
  const changes = new Map<string, number>()
  for (const [key, close] of point.balances) {
    const change = Math.round((close - (point.startBalances.get(key) ?? 0)) * 100) / 100
    if (change !== 0) changes.set(key, change)
  }
  return changes
}
