import { Image, Pressable, Text, View } from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import { colors } from '@/constants/theme'
import { FINANCEKIT_ITEM_ID } from '@/lib/financekit/mergeAccounts'
import { formatAmount, formatMaskableAmount } from '@/lib/format/money'
import { ScrollingText } from '@/components/ui/ScrollingText'

interface AccountRowProps {
  name: string
  balance: number
  variant: 'cash' | 'credit' | 'investment' | 'cashOnHand'
  limit?: number | null
  /** The first row in its section draws no rule above it: the section's header band sits there. */
  isFirst?: boolean
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

// Above this share of the limit, utilization starts to weigh on a credit score — the usual
// guideline, and the point where the bar turns from teal to red.
const HIGH_UTILIZATION = 0.3

// Sized so the rows read as a list under the hero card rather than competing with it.
const ICON_SIZE = 28

// The icon and name together take at most this share of the row; the rest belongs to the balance.
const NAME_AREA_MAX_WIDTH = '62%'

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

export function AccountRow({
  name,
  balance,
  variant,
  limit,
  isFirst,
  isMasked,
  logo,
  itemId,
  onPress,
  onLongPress,
  onPressOut,
  delayLongPress,
}: AccountRowProps) {
  const balanceColor = variant === 'credit' ? colors.expense : colors.textPrimary
  const icon = accountFallbackIcon(variant, itemId)
  // Charge cards report no preset limit as 0, which would read as "0% of $0.00".
  const hasLimit = variant === 'credit' && limit != null && limit > 0

  return (
    <Pressable
      onPress={onPress}
      onLongPress={onLongPress}
      onPressOut={onPressOut}
      delayLongPress={delayLongPress}
      className="flex-row items-center justify-between py-3.5"
      // A rule above every row but the first, splitting each account from the one before it.
      style={isFirst ? undefined : { borderTopWidth: 1, borderColor: colors.primaryHairline }}
    >
      {/* Capped so the name stops well short of the balance, leaving a clear gap between them. */}
      <View className="flex-1 flex-row items-center gap-3" style={{ maxWidth: NAME_AREA_MAX_WIDTH }}>
        {/* The same 28pt box for every row, logo or not, so names line up down the list. A logo sits
            on the row itself: many are transparent PNGs, and a tinted tile shows through behind
            them as a grey box. Only the fallback glyphs get a tile, in the console's pale teal. */}
        {logo ? (
          <Image source={{ uri: `data:image/png;base64,${logo}` }} style={{ width: ICON_SIZE, height: ICON_SIZE }} resizeMode="contain" />
        ) : (
          <View className="h-7 w-7 items-center justify-center rounded-sm" style={{ backgroundColor: colors.primaryMuted }}>
            <Ionicons name={icon.name as any} size={15} color={icon.color} />
          </View>
        )}
        <View className="flex-1 justify-center">
          <ScrollingText
            className="font-sansMed text-base text-textPrimary"
            pressProps={{ onPress, onLongPress, onPressOut, delayLongPress }}
          >
            {name}
          </ScrollingText>
        </View>
      </View>
      <View className="ml-3 items-end gap-1">
        <Text className="font-mono text-amount" style={{ color: balanceColor }}>
          {formatMaskableAmount(balance, isMasked)}
        </Text>
        {hasLimit ? <UtilizationLine balance={balance} limit={limit!} isMasked={isMasked} /> : null}
      </View>
    </Pressable>
  )
}
