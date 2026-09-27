import { assetClassColors, hexToRgba, liabilityColors } from '@/constants/theme'
import { CASH_ON_HAND_KEY } from '@/lib/accounts/composition'
import { accountFallbackIcon, variantIcons } from '@/components/accounts/AccountRow'
import type { NetWorthSeries } from '@/lib/accounts/netWorthSeries'

// Cash and Investments borrow the holdings map's own scale rather than introducing another
// palette — the two maps sit two taps apart and should read as one visual language. Debt is
// the deliberate exception: it gets rose, because owing money is a different KIND of thing
// from owning it and colour is the only place that can be said.
export const GROUP_COLORS = {
  cash: assetClassColors.cash,
  investment: assetClassColors.equity,
  liability: liabilityColors,
} as const

/**
 * Stand-in glyph when Plaid has no logo for an institution, or the row has no institution at
 * all. Mirrors the accounts list's own fallbacks so the same account looks the same everywhere.
 */
export function fallbackIconFor(groupKey: string, accountKey: string, itemId: string | null) {
  if (accountKey === CASH_ON_HAND_KEY) return variantIcons.cashOnHand
  const variant = groupKey === 'investment' ? 'investment' : groupKey === 'liability' ? 'credit' : 'cash'
  // Through the shared helper, so an Apple account carries the same mark it does in the list.
  return accountFallbackIcon(variant, itemId)
}

// Stepped per account inside a group, so two same-family neighbours in a bar never read as one
// band. Opaque enough at the top of the ramp to hold up as a thin bar, which the treemap's much
// paler tiles would not.
const SEGMENT_OPACITY_MAX = 0.9
const SEGMENT_OPACITY_STEP = 0.2
const SEGMENT_OPACITY_MIN = 0.3

/** The fill for an account's bar segment and its swatch in the breakdown — one colour, both places. */
export function seriesColor(series: Pick<NetWorthSeries, 'group' | 'indexInGroup'>): string {
  const opacity = Math.max(SEGMENT_OPACITY_MAX - series.indexInGroup * SEGMENT_OPACITY_STEP, SEGMENT_OPACITY_MIN)
  return hexToRgba(GROUP_COLORS[series.group].fill, opacity)
}
