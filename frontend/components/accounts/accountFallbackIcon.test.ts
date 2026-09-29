import { describe, expect, it, vi } from 'vitest'

/**
 * The glyph an account shows when no institution logo exists for it.
 *
 * Apple accounts are the case worth pinning: FinanceKit supplies no logo, so before this rule they
 * fell through to the same grey card as any unlinked credit account — a "logo failed to load" look
 * on a row named Apple Card. The list and the net worth map both read this function, which is what
 * keeps them showing the same account the same way.
 */

// react-native and the icon font cannot be imported under vitest's node environment; the module
// under test only needs them to exist, since nothing here renders.
vi.mock('react-native', () => ({
  Image: () => null,
  Pressable: () => null,
  ScrollView: () => null,
  Text: () => null,
  View: () => null,
}))
vi.mock('react-native-svg', () => ({
  default: () => null,
  Defs: () => null,
  LinearGradient: () => null,
  Rect: () => null,
  Stop: () => null,
}))
vi.mock('@expo/vector-icons', () => ({ Ionicons: () => null }))

const { accountFallbackIcon, variantIcons } = await import('./AccountRow')

describe('accountFallbackIcon', () => {
  it('gives an Apple account the Apple mark', () => {
    expect(accountFallbackIcon('credit', 'financekit').name).toBe('logo-apple')
  })

  it('gives every other account its variant glyph', () => {
    expect(accountFallbackIcon('credit', 'item-abc')).toBe(variantIcons.credit)
    expect(accountFallbackIcon('investment', null)).toBe(variantIcons.investment)
    expect(accountFallbackIcon('cashOnHand')).toBe(variantIcons.cashOnHand)
  })

  it('falls back to cash for a variant it does not know', () => {
    expect(accountFallbackIcon('mystery', 'item-abc')).toBe(variantIcons.cash)
  })
})
