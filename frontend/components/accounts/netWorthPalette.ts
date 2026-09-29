import { assetClassColors, liabilityColors } from '@/constants/theme'
import { CASH_ON_HAND_KEY } from '@/lib/accounts/composition'
import { accountFallbackIcon, variantIcons } from '@/components/accounts/AccountRow'

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
