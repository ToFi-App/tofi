import { squarify } from './treemap'
import type { TreemapRect } from './treemap'
import { computeCashOnHand, isInvestmentAccount, isLiabilityAccount } from './netWorth'
import type { Account } from '@/types/domain'
import type { FeedItem } from '@/lib/transactions/resolveFeed'

/**
 * What the balance sheet is MADE OF, as a two-level part-of-whole: groups, and the accounts
 * inside each.
 *
 * The denominator is GROSS — assets plus liabilities, both counted positive — not net worth.
 * A treemap tile cannot have negative area, so debt can only appear alongside assets if it
 * contributes positively to the total. Every printed percentage is therefore a share of the
 * whole balance sheet, which is why nothing here is labelled "of net worth": those would be
 * different numbers, and two of them would exceed 100%.
 */

export interface CompositionAccount {
  key: string
  label: string
  /** Debt. Coloured differently from its neighbours despite sharing their block. */
  isLiability: boolean
  /** Base64 PNG institution logo, when the item came from a linked institution. */
  logo: string | null
  /** The account's item, null for the built-in cash row. Read only to spot Apple accounts, which
   *  have no logo and take the Apple mark rather than a generic glyph. */
  itemId: string | null
  /** Masked account number ("··1234"), null for the built-in cash row. */
  mask: string | null
  value: number
  /** Share of its own GROUP, 0..1 — the denominator for a tile inside a group's box. */
  weight: number
  /** Share of the gross total, 0..1 — what the tile's printed percentage means. */
  shareOfTotal: number
}

export interface CompositionGroup {
  key: 'cash' | 'investment'
  label: string
  /** Always positive, including for liabilities — an area cannot be negative. */
  value: number
  /** Share of the gross total, 0..1. */
  weight: number
  accounts: CompositionAccount[]
}

/**
 * A colour key entry, NOT a block. Liabilities have no block of their own — they sit inside
 * the cash block — so this reports the share every tile of a given colour adds up to.
 */
export interface LegendEntry {
  key: 'investment' | 'cash' | 'liability'
  label: string
  weight: number
}

export interface NetWorthComposition {
  groups: CompositionGroup[]
  legend: LegendEntry[]
  /** Assets plus liabilities. The denominator every printed percentage is measured against. */
  total: number
}

/** Synthetic key for the built-in cash row, which has no Plaid account behind it. */
export const CASH_ON_HAND_KEY = '__cash_on_hand__'

/**
 * Accounts and cash on hand -> balance-sheet groups with per-account children.
 *
 * Today's balances by default. Pass `balances` (from computeAccountHistory) to draw a past month
 * instead: keyed by account id plus CASH_ON_HAND_KEY, signed as net worth counts them, so a
 * liability arrives negative and is flipped back to the amount owed here.
 */
export function computeNetWorthComposition(
  accounts: Account[],
  feed: FeedItem[],
  balances?: Map<string, number>,
): NetWorthComposition {
  const cash: CompositionAccount[] = []
  const investment: CompositionAccount[] = []
  const liability: CompositionAccount[] = []

  for (const account of accounts) {
    const signed = balances?.get(account.account_id)
    const value =
      signed === undefined ? (account.balances?.current ?? 0) : isLiabilityAccount(account) ? -signed : signed
    // Non-positive balances are dropped rather than drawn: an overdrawn checking account or a
    // paid-off card has no area to occupy, and letting it through would either invert a tile
    // or silently skew every other percentage.
    if (value <= 0) continue
    const isLiability = isLiabilityAccount(account)
    const entry = {
      key: account.account_id,
      label: account.name,
      isLiability,
      logo: account.institutionLogo || null,
      itemId: account.itemId ?? null,
      mask: account.mask ? `··${account.mask}` : null,
      value,
      weight: 0,
      shareOfTotal: 0,
    }
    if (isLiability) liability.push(entry)
    else if (isInvestmentAccount(account)) investment.push(entry)
    else cash.push(entry)
  }

  const cashOnHand = balances ? (balances.get(CASH_ON_HAND_KEY) ?? 0) : computeCashOnHand(feed)
  if (cashOnHand > 0) {
    // The built-in cash row has no institution behind it, so no logo, no item and no mask.
    cash.push({
      key: CASH_ON_HAND_KEY,
      label: 'Cash',
      isLiability: false,
      logo: null,
      itemId: null,
      mask: null,
      value: cashOnHand,
      weight: 0,
      shareOfTotal: 0,
    })
  }

  const groups: CompositionGroup[] = []
  const sumOf = (entries: CompositionAccount[]) => entries.reduce((sum, e) => sum + e.value, 0)
  const cashValue = sumOf(cash)
  const investmentValue = sumOf(investment)
  const liabilityValue = sumOf(liability)
  const total = cashValue + investmentValue + liabilityValue

  // Debt shares the cash block rather than holding one of its own. A group containing a
  // single sub-1% account degenerates into a line spanning the map — the right area, an
  // untappable shape. Beside the cash accounts it gets a tile of ordinary proportions, and
  // stays distinguishable by colour rather than by position.
  const cashBlock = [...cash, ...liability].sort((a, b) => b.value - a.value)
  const cashBlockValue = cashValue + liabilityValue

  if (investmentValue > 0) {
    groups.push({ key: 'investment', label: 'Investments', value: investmentValue, weight: 0, accounts: investment })
  }
  if (cashBlockValue > 0) {
    groups.push({ key: 'cash', label: 'Cash', value: cashBlockValue, weight: 0, accounts: cashBlock })
  }

  // Largest group first, and largest account first inside it — squarify assumes descending
  // weight, and it also puts the account the user most wants to see in the biggest tile.
  groups.sort((a, b) => b.value - a.value)
  for (const group of groups) {
    group.weight = total > 0 ? group.value / total : 0
    group.accounts.sort((a, b) => b.value - a.value)
    for (const entry of group.accounts) {
      entry.weight = group.value > 0 ? entry.value / group.value : 0
      entry.shareOfTotal = total > 0 ? entry.value / total : 0
    }
  }

  const share = (value: number) => (total > 0 ? value / total : 0)
  const legend: LegendEntry[] = []
  if (investmentValue > 0) legend.push({ key: 'investment', label: 'Investments', weight: share(investmentValue) })
  if (cashValue > 0) legend.push({ key: 'cash', label: 'Cash', weight: share(cashValue) })
  if (liabilityValue > 0) legend.push({ key: 'liability', label: 'Liabilities', weight: share(liabilityValue) })

  return { groups, legend, total }
}

export interface CompositionLayout {
  group: CompositionGroup
  /** Account tiles, already translated into the map's coordinate space. */
  accounts: TreemapRect<CompositionAccount>[]
}

export interface CompositionMap {
  layouts: CompositionLayout[]
  /**
   * The height the map actually needs, which may exceed the height requested — see
   * minTileHeight in layoutComposition.
   */
  height: number
}

/**
 * Two-level treemap: groups fill the box, then each group's accounts fill that group's rect.
 *
 * Areas are TRUE. Every tile occupies exactly its share of the whole — assets and liabilities
 * together — so a 0.1% card is a 0.1% square and the picture can be read by eye rather than
 * only by its printed number.
 *
 * Nothing is floored, stretched or reshaped. All three were tried — flooring small weights,
 * stretching the map to guarantee a legible minimum, and squaring extreme slivers — and each
 * either lies about area or opens gaps in a layout whose whole job is conveying proportion.
 * Tiles keep the exact rects they are dealt; a tile too small to carry a label simply carries
 * none, and is identified by tapping it. That is what the caption below the map is for.
 */
export function layoutComposition(
  groups: CompositionGroup[],
  width: number,
  height: number,
): CompositionMap {
  const layouts = squarify(groups, width, height).map((rect) => {
    const accounts = squarify(rect.item.accounts, rect.width, rect.height).map((child) => ({
      ...child,
      // Child coordinates come back relative to the group's box; translate them into the
      // map's space so every tile can be positioned absolutely from one origin.
      x: child.x + rect.x,
      y: child.y + rect.y,
    }))
    return { group: rect.item, accounts }
  })
  return { layouts, height }
}

