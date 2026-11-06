import { useState } from 'react'
import { ActivityIndicator, Pressable, Text, View } from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import { colors, hexToRgba } from '@/constants/theme'
import { formatAmount } from '@/lib/format/money'
import { useAccountMarks } from '@/hooks/useAccountMarks'
import { AccountMarkChip } from '@/components/accounts/AccountMarkChip'
import { TRANSFER_TYPES } from '@/lib/transfers/registry'
import type { FeedItem, FeedLink } from '@/lib/transactions/resolveFeed'

interface LinkedTransactionsProps {
  item: FeedItem
  onUnlink: (link: FeedLink) => Promise<void>
  /** Opens the linked transaction's own sheet. */
  onOpen: (link: FeedLink) => void
}

/**
 * What this transaction is linked to, and the way to undo any one of those links.
 *
 * Reads straight off item.links, which resolveFeed fills with a snapshot of each counterpart —
 * this sheet is opened from surfaces holding only a slice of the feed (one account, one category),
 * where looking the counterpart up would usually fail.
 */
export function LinkedTransactions({ item, onUnlink, onOpen }: LinkedTransactionsProps) {
  // Rides the shared accounts query cache, same as TransactionRow. Called before the early return
  // below so the hook order stays fixed across renders.
  const accountMarks = useAccountMarks()
  // Per link, not one flag for the section: unlinking is two round trips (the dismissal, then the
  // delete) and several links can be listed, so the spinner has to name the one being removed.
  // Held above the early return below to keep hook order fixed, same as the logos.
  const [removingId, setRemovingId] = useState<string | null>(null)
  const markFor = (link: FeedLink) => (link.accountId ? accountMarks.get(link.accountId) ?? null : null)

  const handleUnlink = async (link: FeedLink) => {
    setRemovingId(link.recordId)
    try {
      await onUnlink(link)
    } finally {
      setRemovingId(null)
    }
  }

  if (item.links.length === 0) return null

  const type = TRANSFER_TYPES[item.links[0].kind]
  // Counterparts always sit on the opposite side of the ledger from this row, so one look at this
  // item's own sign settles how every link below reads.
  const counterpartSign = item.amount > 0 ? '+' : '-'
  const counterpartColor = item.amount > 0 ? colors.income : colors.expense
  const isReimbursement = item.links[0].kind === 'reimbursement'

  return (
    <View className="gap-3">
      {/* A titled rule rather than a boxed callout: this sits at the foot of the sheet, where a
          divider reads as "and here is what it's tied to" without walling the section off. */}
      <View className="flex-row items-center gap-3">
        <View className="h-px flex-1" style={{ backgroundColor: colors.border }} />
        <View className="flex-row items-center gap-1.5">
          <Ionicons name={type.icon} size={14} color={type.color} />
          <Text className="font-sansSemi text-sm" style={{ color: type.color }}>{type.label}</Text>
        </View>
        <View className="h-px flex-1" style={{ backgroundColor: colors.border }} />
      </View>

      {item.links.map((link) => {
        // The counterpart as it is — the charge's whole amount, not the part this link paid — so
        // the card names which transaction it is. What a reimbursement covered goes beside the
        // date when it's less than that whole, as when the Venmo paid back part of a dinner.
        const counterpartAmount = link.counterpartAmount != null ? Math.abs(link.counterpartAmount) : link.amount
        const coveredPart = isReimbursement && Math.abs(counterpartAmount - link.amount) >= 0.005 ? link.amount : null
        const canOpen = link.itemId != null
        return (
          // Each link is its own tinted card in the kind's colour, so several reimbursements against
          // one expense read as a list of distinct things rather than a run of loose lines. Inside,
          // the two lines pair by weight: title with amount, date with the action that removes it —
          // which gives Unlink a place of its own instead of dangling under the amount. The card
          // opens the counterpart's sheet; Unlink, inside it, takes its own taps.
          <Pressable
            key={link.recordId}
            onPress={canOpen ? () => onOpen(link) : undefined}
            disabled={!canOpen}
            accessibilityRole={canOpen ? 'button' : undefined}
            accessibilityLabel={canOpen ? `Open ${link.merchantName ?? 'linked transaction'}` : undefined}
            className="gap-2 rounded-xl px-3 py-3"
            style={({ pressed }) => ({ backgroundColor: hexToRgba(type.color, pressed ? 0.16 : 0.1) })}
          >
            <View className="flex-row items-center justify-between gap-3">
              {/* No counterpart means an unpaired transfer, or one outside the synced window. Worth
                  saying out loud: it's the only thing here explaining why the row stopped counting. */}
              <Text className="flex-1 font-sansSemi text-base text-textPrimary" numberOfLines={1}>
                {link.itemId ? link.merchantName : 'No linked transaction'}
              </Text>
              {link.itemId ? (
                <View className="flex-row items-center gap-1.5">
                  <Text className="font-mono text-base text-textPrimary">
                    {counterpartSign}{formatAmount(counterpartAmount)}
                  </Text>
                  {/* The same bank chip the feed row wears, so the counterpart is identifiable by
                      the account it hit and not merchant name alone. The ring repeats the
                      counterpart's direction: green when the row it's linked from is an expense. */}
                  <AccountMarkChip mark={markFor(link)} ringColor={counterpartColor} size={17} />
                  <Ionicons name="chevron-forward" size={16} color={colors.textSecondary} />
                </View>
              ) : null}
            </View>

            <View className="flex-row items-center justify-between gap-3">
              <Text className="shrink font-sansMed text-sm text-textPrimary" numberOfLines={1}>
                {link.date}
                {coveredPart != null ? (
                  <Text className="font-sansSemi" style={{ color: type.color }}>{`  ·  ${formatAmount(coveredPart)} reimbursed`}</Text>
                ) : null}
              </Text>
              <Pressable
                onPress={() => void handleUnlink(link)}
                // Any removal in flight locks every chip: they all write to the same link set, and a
                // second tap while one is mid-flight is the accidental double-unlink, not a choice.
                disabled={removingId != null}
                hitSlop={8}
                accessibilityRole="button"
                accessibilityState={{ disabled: removingId != null, busy: removingId === link.recordId }}
                // Minimum width keeps the chip from collapsing around the spinner, so the card holds
                // its shape while the row it belongs to is on its way out.
                // Fixed box, not padding: the spinner is taller than the label it replaces, and
                // letting the chip grow would shove the card's last line down mid-removal. 24px is
                // what px-3 py-1 around text-xs already measured.
                className="h-[24px] min-w-[62px] items-center justify-center rounded-full border px-3"
                style={{
                  borderColor: hexToRgba(type.color, 0.45),
                  opacity: removingId != null && removingId !== link.recordId ? 0.4 : 1,
                }}
              >
                {removingId === link.recordId ? (
                  <ActivityIndicator size="small" color={type.color} />
                ) : (
                  <Text className="font-sansMed text-xs" style={{ color: type.color }}>Unlink</Text>
                )}
              </Pressable>
            </View>
          </Pressable>
        )
      })}

    </View>
  )
}
