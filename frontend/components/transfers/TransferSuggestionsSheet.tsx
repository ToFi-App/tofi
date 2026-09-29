import { useEffect, useState } from 'react'
import { ActivityIndicator, Pressable, ScrollView, Text, View } from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import { BottomSheet, useSheetScroll } from '@/components/ui/BottomSheet'
import { colors, hexToRgba } from '@/constants/theme'
import { TRANSFER_TYPES } from '@/lib/transfers/registry'
import { formatAmount } from '@/lib/format/money'
import type { FeedItem } from '@/lib/transactions/resolveFeed'
import type { TransferDraft } from '@/lib/transfers/autoMatch'
import type { TransferSuggestion } from '@/hooks/useTransactionFeed'
import type { Account } from '@/types/domain'
import { SheetHeader } from '@/components/ui/SheetHeader'

// The medium-confidence tier of transfer auto-detection, surfaced as one-tap decisions.
// Collapsed to a single banner row on the transactions screen (rendered only when there is
// something to decide); the full list lives in a swipe-dismissable bottom sheet so several
// suggestions never crowd the screen. Confirming creates a normal manual-source transfer
// (the user vouched); dismissing records a transfer_dismissal so the pair never resurfaces.

/** Same compact form as the list's section headers (8/4), readable at a glance. */
function shortDate(date: string): string {
  const parsed = new Date(`${date}T00:00:00`)
  return `${parsed.getMonth() + 1}/${parsed.getDate()}`
}

interface TransferSuggestionsBannerProps {
  count: number
  onPress: () => void
}

export function TransferSuggestionsBanner({ count, onPress }: TransferSuggestionsBannerProps) {
  if (count === 0) return null
  return (
    <Pressable
      onPress={onPress}
      className="flex-row items-center gap-2 rounded-xl bg-surface px-4 py-3"
    >
      <Ionicons name="sparkles-outline" size={16} color={colors.transfer} />
      <Text className="flex-1 font-sansMed text-base text-textPrimary">
        {count === 1 ? 'Possible transfer' : 'Possible transfers'}
      </Text>
      {/* Count as a notification-style badge — it reads as "N waiting" at a glance. Same
          token as the sparkles icon, so the whole banner speaks one color. */}
      <View
        className="items-center justify-center rounded-full px-1.5"
        style={{ backgroundColor: colors.transfer, minWidth: 20, height: 20 }}
      >
        <Text className="font-sansMed text-xs" style={{ color: colors.textInverse }}>
          {count}
        </Text>
      </View>
    </Pressable>
  )
}

interface TransferSuggestionsSheetProps {
  visible: boolean
  suggestions: TransferSuggestion[]
  /** Pairs with a still-pending leg: informational only, matched for real once posted. */
  pendingPreviews?: TransferDraft[]
  accounts: Account[]
  onClose: () => void
  onConfirm: (suggestion: TransferSuggestion) => Promise<void>
  onDismiss: (suggestion: TransferSuggestion) => Promise<void>
}

export function TransferSuggestionsSheet({ visible, suggestions, pendingPreviews = [], accounts, onClose, onConfirm, onDismiss }: TransferSuggestionsSheetProps) {
  const [busyId, setBusyId] = useState<string | null>(null)
  const sheetScroll = useSheetScroll()

  // Acting on the last suggestion leaves nothing to decide — close rather than show an
  // empty sheet. Pending previews count as content: a sheet of only-pending pairs stays open.
  useEffect(() => {
    if (visible && suggestions.length === 0 && pendingPreviews.length === 0) onClose()
  }, [visible, suggestions.length, pendingPreviews.length, onClose])

  // Institution name + mask ("Bank of America ··0533") — the way people identify a card;
  // Plaid has no abbreviated institution form. Merchant string only as a last resort.
  function accountLabel(item: FeedItem): string {
    const account = accounts.find((a) => a.account_id === item.accountId)
    if (!account) return item.merchantName
    return account.mask ? `${account.institutionName} ··${account.mask}` : account.institutionName
  }

  async function act(suggestion: TransferSuggestion, action: (s: TransferSuggestion) => Promise<void>) {
    setBusyId(suggestion.expense.id)
    try {
      await action(suggestion)
    } finally {
      setBusyId(null)
    }
  }

  return (
    <BottomSheet visible={visible} onClose={onClose} contentScroll={sheetScroll}>
      <SheetHeader
        title={
          suggestions.length + pendingPreviews.length === 1
            ? 'Possible transfer'
            : `Possible transfers (${suggestions.length + pendingPreviews.length})`
        }
        onClose={onClose}
      />

      <ScrollView {...sheetScroll.scrollProps} className="px-5" contentContainerClassName="gap-5 pb-10">
        {suggestions.map((suggestion) => {
          const type = TRANSFER_TYPES[suggestion.kind]
          const busy = busyId === suggestion.expense.id
          return (
            <View key={`${suggestion.expense.id}:${suggestion.income.id}`} className="gap-3 border-b pb-5" style={{ borderColor: colors.border }}>
              {/* Entry-style row: from/to stacked on two lines so a long bank name never
                  hides the destination; amount and dates in the right column. */}
              <View className="flex-row items-center gap-3">
                <View className="h-10 w-10 items-center justify-center rounded-full" style={{ backgroundColor: hexToRgba(type.color, 0.18) }}>
                  <Ionicons name={type.icon} size={18} color={type.color} />
                </View>
                <View className="flex-1 gap-1">
                  {/* Source above, destination below, arrow marking the direction — reads as
                      "money moved down the page". middle-ellipsis so a long institution name
                      never swallows the mask, the part that actually identifies the card. */}
                  <Text className="font-sansSemi text-base text-textPrimary" numberOfLines={1} ellipsizeMode="middle">
                    {accountLabel(suggestion.expense)}
                  </Text>
                  <Ionicons name="arrow-down" size={14} color={colors.textMuted} />
                  <Text className="font-sansSemi text-base text-textPrimary" numberOfLines={1} ellipsizeMode="middle">
                    {accountLabel(suggestion.income)}
                  </Text>
                </View>
                <View className="ml-3 items-end gap-0.5">
                  <Text className="font-mono text-base text-textPrimary">{formatAmount(suggestion.amount)}</Text>
                  <Text className="font-sans text-xs text-textSecondary">
                    {suggestion.expense.date === suggestion.income.date
                      ? shortDate(suggestion.expense.date)
                      : `${shortDate(suggestion.expense.date)} → ${shortDate(suggestion.income.date)}`}
                  </Text>
                </View>
              </View>

              <View className="flex-row items-center gap-2">
                <Pressable
                  disabled={busy}
                  onPress={() => act(suggestion, onConfirm)}
                  className="flex-1 items-center rounded-full px-3 py-2"
                  style={{ backgroundColor: busy ? hexToRgba(type.color, 0.4) : type.color }}
                >
                  {busy ? (
                    <ActivityIndicator size="small" color={colors.textInverse} />
                  ) : (
                    <Text className="font-sansMed text-sm" style={{ color: colors.textInverse }}>
                      Link as transfer
                    </Text>
                  )}
                </Pressable>
                <Pressable
                  disabled={busy}
                  onPress={() => act(suggestion, onDismiss)}
                  className="flex-1 items-center rounded-full border border-border px-3 py-2"
                >
                  <Text className="font-sansMed text-sm text-textSecondary">Not a transfer</Text>
                </Pressable>
              </View>
            </View>
          )
        })}

        {pendingPreviews.length > 0 ? (
          <View className="gap-5">
            <View className="gap-1">
              <Text className="font-display text-base text-textPrimary">Waiting to post</Text>
              <Text className="font-sans text-xs leading-4 text-textMuted">
                These look like transfers, but a side is still pending. They'll be matched
                automatically once both transactions post — usually 1–3 business days.
              </Text>
            </View>
            {pendingPreviews.map((preview) => {
              const type = TRANSFER_TYPES[preview.kind]
              return (
                <View
                  key={`${preview.expense.id}:${preview.income.id}`}
                  className="gap-3 border-b pb-5"
                  style={{ borderColor: colors.border, opacity: 0.85 }}
                >
                  <View className="flex-row items-center gap-3">
                    <View className="h-10 w-10 items-center justify-center rounded-full" style={{ backgroundColor: hexToRgba(type.color, 0.12) }}>
                      <Ionicons name="time-outline" size={18} color={type.color} />
                    </View>
                    <View className="flex-1 gap-1">
                      <Text className="font-sansSemi text-base text-textPrimary" numberOfLines={1} ellipsizeMode="middle">
                        {accountLabel(preview.expense)}
                      </Text>
                      <Ionicons name="arrow-down" size={14} color={colors.textMuted} />
                      <Text className="font-sansSemi text-base text-textPrimary" numberOfLines={1} ellipsizeMode="middle">
                        {accountLabel(preview.income)}
                      </Text>
                    </View>
                    <View className="ml-3 items-end gap-1">
                      <Text className="font-mono text-base text-textPrimary">{formatAmount(preview.amount)}</Text>
                      <View className="rounded-full px-2 py-0.5" style={{ backgroundColor: hexToRgba(type.color, 0.14) }}>
                        <Text className="font-sansMed text-xs" style={{ color: type.color }}>Pending</Text>
                      </View>
                    </View>
                  </View>
                </View>
              )
            })}
          </View>
        ) : null}
      </ScrollView>
    </BottomSheet>
  )
}
