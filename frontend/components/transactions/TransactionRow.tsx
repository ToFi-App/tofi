import { memo } from 'react'
import { Pressable, Text, View } from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import { colors, hexToRgba } from '@/constants/theme'
import { CategoryIcon } from '@/components/categories/CategoryIcon'
import { TRANSFER_TYPES } from '@/lib/transfers/registry'
import { formatAmount } from '@/lib/format/money'
import { countsTowardTotals, isInvestmentSweep, isUnlinkedInternalTransfer } from '@/lib/transactions/totals'
import { amountSign, transactionAmountColor } from '@/lib/transactions/amountDisplay'
import { linkPillLabel } from '@/lib/transactions/linkSummary'
import { useAccountMarks } from '@/hooks/useAccountMarks'
import { AccountMarkChip } from '@/components/accounts/AccountMarkChip'
import type { FeedItem } from '@/lib/transactions/resolveFeed'

/** Identity-compared below: pending renders as plain text rather than a pill. */
const PENDING_BADGE = { label: 'Pending', color: colors.textMuted }

interface TransactionRowProps {
  item: FeedItem
  categoryName: string
  categoryColor: string
  /** Icon slug; null when the item has no category, which renders the uncategorized fallback. */
  categoryIcon: string | null
  reimbursementCategoryName: string | null
  /**
   * Takes the row's item rather than closing over it, so the list can hand every row the SAME
   * callback. A per-row arrow would give each row a fresh prop on every parent render and defeat
   * the memo below — which is the whole reason opening a sheet used to re-render the month.
   */
  onPress?: (item: FeedItem) => void
  /**
   * The group this row belongs to, shown as a tappable pill on its second line
   * (docs/transaction-groups.md §2). Primitives rather than an object so the memo's shallow
   * compare still holds.
   */
  groupId?: string | null
  groupName?: string | null
  groupColor?: string | null
  /** Takes the id rather than closing over it, for the same reason as onPress. */
  onGroupPress?: (groupId: string) => void
}

function TransactionRowComponent({
  item,
  categoryName,
  categoryColor,
  categoryIcon,
  reimbursementCategoryName,
  onPress,
  groupId,
  groupName,
  groupColor,
  onGroupPress,
}: TransactionRowProps) {
  // Resolved here rather than passed in, so EVERY surface that renders an entry — the
  // transactions list, account/category detail sheets, anything added later — shows the
  // bank badge without each parent re-wiring it. Rides the shared accounts query cache.
  const accountMarks = useAccountMarks()
  const accountMark = item.accountId ? accountMarks.get(item.accountId) ?? null : null
  const transferType = item.transferKind ? TRANSFER_TYPES[item.transferKind] : null
  // Greyed when the totals leave it out, so the row reads as "not spending, not income" at a
  // glance. Shared with the detail sheet, which has to reach the same verdict.
  const isExcluded = !countsTowardTotals(item)
  const amountColor = transactionAmountColor(item)
  // One badge slot, three sources. A transfer leg names its kind. A reimbursement leg has no
  // transferKind to name — applyTransfers stamps only the other kinds — so it names what came
  // back, which the row's gross amount alone can't convey. A brokerage-cash sweep has no
  // record at all, so it says "Investment", otherwise it would grey out with nothing on the row
  // explaining why it stopped counting; muted rather than coloured, since unlike a transfer or a
  // reimbursement this wasn't a link the user made or confirmed, so it shouldn't shout.
  const reimbursementPill = linkPillLabel(item)
  const badge = transferType
    ? {
        label: item.transferSource === 'auto' ? `${transferType.shortLabel} · Auto` : transferType.shortLabel,
        color: transferType.color,
      }
    : reimbursementPill
      ? { label: reimbursementPill, color: colors.reimbursed }
      : isInvestmentSweep(item)
        ? { label: 'Investment', color: colors.textMuted }
        : isUnlinkedInternalTransfer(item)
          ? // Money that left for another of the user's own accounts, which is why it stopped
            // counting — but no Transfer record names the other side yet, so it can't claim the
            // transfer badge. Muted for the same reason "Investment" is: nothing here was
            // confirmed by the user.
            { label: 'Internal', color: colors.textMuted }
          : item.pending
          ? // The bank hasn't settled this yet, which is also why the account's balance won't
            // reflect it — Plaid's `current` balance moves only when a transaction posts.
            // Labelling the row is what makes that mismatch read as "in progress" rather
            // than "wrong". Muted: it's a state, not a link the user made.
            PENDING_BADGE
          : null
  const iconColor = transferType ? transferType.color : item.isReimbursementIncome ? colors.reimbursed : categoryColor
  const iconBg = hexToRgba(iconColor, 0.18)

  return (
    <Pressable onPress={() => onPress?.(item)} className="flex-row items-center gap-3 py-3">
      <View className="h-10 w-10 items-center justify-center rounded-full" style={{ backgroundColor: iconBg }}>
        {transferType ? (
          <Ionicons name={transferType.icon} size={18} color={iconColor} />
        ) : item.isReimbursementIncome ? (
          // Sourced from the transfer registry, not a second hardcoded copy: a reimbursement
          // IS a transfer kind, so its icon lives there alongside the label and colour this
          // row already reads from it. An emoji stood here before, which rendered at a
          // different weight from every other row's Ionicon and ignored iconColor entirely.
          <Ionicons name={TRANSFER_TYPES.reimbursement.icon} size={18} color={iconColor} />
        ) : (
          <CategoryIcon icon={categoryIcon} size={18} color={iconColor} />
        )}
        {item.source === 'manual' ? (
          // Ionicon rather than an emoji, like every other glyph in this row: emoji carry
          // their own colour, so this badge could never be tinted and rendered at a weight
          // that didn't match the icon it sits on.
          <View className="absolute -bottom-0.5 -right-0.5 h-4 w-4 items-center justify-center rounded-full bg-surface">
            <Ionicons name="pencil" size={9} color={colors.textSecondary} />
          </View>
        ) : null}
      </View>

      <View className="flex-1 gap-0.5">
        <Text
          className={`font-sansSemi text-base ${isExcluded ? 'text-textSecondary' : 'text-textPrimary'}`}
          numberOfLines={1}
        >
          {item.isReimbursementIncome
            ? reimbursementCategoryName
              ? `Reimbursement · ${reimbursementCategoryName}`
              : 'Reimbursement'
            : categoryName}
        </Text>
        <Text className="font-sans text-sm text-textSecondary" numberOfLines={1}>
          {/* A user-written note beats the raw merchant string — the same rule manual rows
              follow, where the note IS the display name. */}
          {item.note ?? item.merchantName}
        </Text>
      </View>

      <View className="ml-3 items-end gap-0.5">
        <View className="flex-row items-center gap-1.5">
          {/* A reimbursed expense shows what was charged, matching the statement; the pill below
              carries what came back and the net. */}
          <Text className="font-mono text-base" style={{ color: amountColor }}>
            {amountSign(item)}{formatAmount(Math.abs(item.amount))}
          </Text>
          {/* Which card/bank this hit, at a glance — mirrors the amount-side bank chip in apps
              like the reference tracker. */}
          <AccountMarkChip mark={accountMark} ringColor={amountColor} size={17} />
        </View>
        {badge === PENDING_BADGE ? (
          // Pending is a state, not a link the user made, so it drops the pill: a day of
          // unsettled charges stacked three grey capsules down the right edge and made the rows
          // look heavier than the settled ones. A small clock and muted text say the same thing.
          <View className="flex-row items-center gap-1">
            <Ionicons name="time-outline" size={12} color={colors.textMuted} />
            <Text className="font-sans text-xs text-textMuted">Pending</Text>
          </View>
        ) : badge ? (
          // Under the amount, not beside the title: the badge is the row's meaning ('Auto'
          // marks links made by auto-detection; unmarking is the one-tap undo) and here it
          // never competes with the category name for width.
          // maxWidth so the longest label (a reimbursement's "$2,000.00 back · net -$55.32")
          // ellipsizes instead of squeezing the category name out of the row.
          <View className="rounded-full px-2 py-0.5" style={{ backgroundColor: hexToRgba(badge.color, 0.14), maxWidth: 200 }}>
            <Text className="font-sansMed text-xs" numberOfLines={1} style={{ color: badge.color }}>
              {badge.label}
            </Text>
          </View>
        ) : null}
        {groupId && groupName && groupColor ? (
          // Its own Pressable inside the row's: a tap on the pill opens the group, a tap anywhere
          // else still opens the transaction. In the right column with the other badges rather
          // than beside the merchant, where it squeezed the name the row is recognised by.
          <Pressable
            onPress={() => onGroupPress?.(groupId)}
            hitSlop={6}
            accessibilityRole="button"
            accessibilityLabel={`Open group ${groupName}`}
            className="flex-row items-center gap-0.5 rounded-full px-2 py-0.5"
            style={{ backgroundColor: hexToRgba(groupColor, 0.14), maxWidth: 160 }}
          >
            <Text className="shrink font-sansMed text-xs" numberOfLines={1} style={{ color: groupColor }}>
              {groupName}
            </Text>
            <Ionicons name="chevron-forward" size={10} color={groupColor} />
          </Pressable>
        ) : null}
      </View>
    </Pressable>
  )
}

/**
 * Memoized because a list renders a whole month of these, and every sheet open/close used to
 * re-render all of them. Props are the item plus primitives, so the default shallow compare is
 * exactly right: a row re-renders when its own transaction changes and not otherwise.
 */
export const TransactionRow = memo(TransactionRowComponent)
