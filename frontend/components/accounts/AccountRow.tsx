import { Image, Text, View } from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import { colors, hexToRgba } from '@/constants/theme'
import { FINANCEKIT_ITEM_ID } from '@/lib/financekit/mergeAccounts'
import { formatAmount, formatMaskableAmount } from '@/lib/format/money'
import { AccountGlyph } from '@/components/accounts/AccountGlyph'
import { ListCard, ListCardValue } from '@/components/networth/ListCard'

interface AccountRowProps {
  name: string
  /** The line under the name: the institution, or what the account is ("On hand"). */
  subtitle?: string | null
  balance: number
  variant: 'cash' | 'credit' | 'investment' | 'cashOnHand'
  limit?: number | null
  isMasked: boolean
  /** Base64 PNG institution logo; replaces the generic variant icon when present. */
  logo?: string | null
  /** The account's item. Only read to spot Apple accounts, which get the Apple mark. */
  itemId?: string | null
  onPress?: () => void
  /**
   * Drag-to-reorder handlers, applied to the SAME Pressable that handles the tap. Wrapping
   * this row in another Pressable would not work: the inner one wins the responder on touch
   * start and the outer never sees the gesture at all.
   */
  onLongPress?: () => void
  onPressOut?: () => void
  delayLongPress?: number
}

/**
 * Stand-in glyphs for accounts with no institution logo. Exported so the composition map
 * falls back to the SAME icon this row does — an account should not be a wallet here and a
 * generic square there.
 */
export const variantIcons: Record<string, { name: string; color: string }> = {
  cash: { name: 'wallet', color: '#3B82F6' },
  investment: { name: 'trending-up', color: '#E11D48' },
  credit: { name: 'card', color: '#6B7280' },
  // Banknotes rather than a wallet, so the always-present cash row reads as distinct from
  // a linked bank account at a glance.
  cashOnHand: { name: 'cash', color: colors.income },
}

/**
 * The Apple mark, standing in for the institution logo FinanceKit does not supply.
 *
 * Apple accounts come from Wallet rather than Plaid, so `institutionLogo` is always null for them
 * and they would otherwise fall back to the grey generic card that every unlinked credit row uses
 * — beside a row named "Apple Card", that reads as a logo that failed to load. Monochrome and in
 * the text colour, matching the Apple row in AddAccountSheet and the sign-in button.
 */
export const appleIcon = { name: 'logo-apple', color: colors.textPrimary }

/**
 * Which glyph an account shows when there is no institution logo to show instead.
 *
 * One function rather than a lookup at each call site, so the accounts list and the net worth map
 * cannot disagree about what an account looks like.
 */
export function accountFallbackIcon(variant: string, itemId?: string | null) {
  if (itemId === FINANCEKIT_ITEM_ID) return appleIcon
  return variantIcons[variant] ?? variantIcons.cash
}

/**
 * An account's mark, in a fixed 28pt box so names line up down any list: its institution's logo, or
 * when there is none, its fallback glyph (accountFallbackIcon) on a pale teal tile. Shared by the
 * accounts list and the account picker, so an account looks the same in both.
 *
 * A logo sits on the row itself: many are transparent PNGs, and a tinted tile shows through behind
 * them as a grey box. Only the fallback glyphs get a tile.
 */
export function AccountIcon({
  logo,
  variant,
  itemId,
  size = ICON_SIZE,
}: {
  logo?: string | null
  variant: string
  itemId?: string | null
  /** The box's side; the list's 28pt by default, smaller where the mark stands in for a control's glyph. */
  size?: number
}) {
  if (logo) {
    return <Image source={{ uri: `data:image/png;base64,${logo}` }} style={{ width: size, height: size }} resizeMode="contain" />
  }
  const icon = accountFallbackIcon(variant, itemId)
  return (
    <View className="items-center justify-center rounded-sm" style={{ width: size, height: size, backgroundColor: colors.primaryMuted }}>
      <Ionicons name={icon.name as any} size={Math.round(size * 0.54)} color={icon.color} />
    </View>
  )
}

// Above this share of the limit, utilization starts to weigh on a credit score — the usual
// guideline, and the point where the bar turns from teal to red.
const HIGH_UTILIZATION = 0.3

// The fallback glyph's box in the account picker and other compact lists.
const ICON_SIZE = 28

/** A row's mark on the Net Worth tab: a logo, or the fallback glyph in a circle. */
const ROW_MARK_SIZE = 36

function UtilizationLine({ balance, limit, isMasked }: { balance: number; limit: number; isMasked: boolean }) {
  const used = Math.max(0, balance) / limit
  const fill = used >= HIGH_UTILIZATION ? colors.expense : colors.primary
  return (
    <View className="flex-row items-center gap-1.5">
      <View className="h-1 w-12 overflow-hidden rounded-full bg-surfaceRaised">
        {/* A sliver even at 0%, so an empty track still reads as a gauge. */}
        <View className="h-full rounded-full" style={{ width: `${Math.min(100, Math.max(used * 100, 3))}%`, backgroundColor: fill }} />
      </View>
      <Text className="font-sans text-xs text-textSecondary">
        {Math.round(used * 100)}% of {isMasked ? 'limit' : formatAmount(limit)}
      </Text>
    </View>
  )
}

/**
 * One account on the Net Worth tab's Overview: its mark, its name over its institution, and its
 * balance on the right — a credit card's with how much of its limit is used under it.
 */
export function AccountRow({
  name,
  subtitle,
  balance,
  variant,
  limit,
  isMasked,
  logo,
  itemId,
  onPress,
  onLongPress,
  onPressOut,
  delayLongPress,
}: AccountRowProps) {
  // Charge cards report no preset limit as 0, which would read as "0% of $0.00".
  const hasLimit = variant === 'credit' && limit != null && limit > 0
  const icon = accountFallbackIcon(variant, itemId)

  return (
    <ListCard
      mark={<AccountGlyph logo={logo} icon={icon} size={ROW_MARK_SIZE} background={hexToRgba(icon.color, 0.1)} />}
      title={name}
      subtitle={subtitle}
      accessibilityLabel={`${name}, ${formatMaskableAmount(balance, isMasked)}`}
      onPress={onPress}
      onLongPress={onLongPress}
      onPressOut={onPressOut}
      delayLongPress={delayLongPress}
      right={
        <>
          <ListCardValue>{formatMaskableAmount(balance, isMasked)}</ListCardValue>
          {hasLimit ? <UtilizationLine balance={balance} limit={limit!} isMasked={isMasked} /> : null}
        </>
      }
    />
  )
}
