import { useState } from 'react'
import { Modal, Pressable, Text, View } from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import { colors } from '@/constants/theme'
import { api } from '@/lib/api/client'
import { oldestInstant } from '@/lib/investments/freshness'
import { formatRelativeIsoTime } from '@/lib/format/date'

/** Plaid syncs investments about once a day, so a sync time read a few minutes ago is still right. */
const SYNC_STALE_MS = 5 * 60 * 1000

/**
 * The ⓘ beside a headline, and what it opens: how current the two inputs behind the figures are.
 * They age separately — positions come from the brokerage through Plaid about once a day, prices
 * from the market feed — so each gets its own time rather than one blended "updated" stamp.
 *
 * The price time is when the price itself was set (its trade, or the brokerage's pricing), never
 * when the app last asked for it: over a weekend a quote fetched a minute ago is still Friday's.
 *
 * The sync times are asked for only once the sheet opens: most visits never tap it, and each
 * institution is its own call.
 */
export function FreshnessInfo({
  itemIds,
  pricedAsOf,
  priceLabel = 'Prices',
}: {
  /** The Plaid items behind the positions in view. */
  itemIds: string[]
  /** When the price shown was set: the oldest across the holdings in view. */
  pricedAsOf: string | null
  priceLabel?: string
}) {
  const [openedAt, setOpenedAt] = useState<number | null>(null)
  const isOpen = openedAt != null

  const syncQueries = api.useQueries((t) =>
    itemIds.map((itemId) => t.investments.syncedAt({ itemId }, { enabled: isOpen, staleTime: SYNC_STALE_MS })),
  )
  const isChecking = syncQueries.some((q) => q.isInitialLoading)
  const syncedAt = oldestInstant(syncQueries.map((q) => q.data))

  const now = openedAt ?? 0
  const positions = isChecking ? 'Checking…' : (formatRelativeIsoTime(syncedAt, now) ?? 'Unavailable')
  const prices = formatRelativeIsoTime(pricedAsOf, now)

  return (
    <>
      <Pressable
        onPress={() => setOpenedAt(Date.now())}
        hitSlop={10}
        accessibilityRole="button"
        accessibilityLabel="How current these figures are"
      >
        <Ionicons name="information-circle-outline" size={16} color={colors.textSecondary} />
      </Pressable>
      <Modal visible={isOpen} transparent animationType="fade" onRequestClose={() => setOpenedAt(null)}>
        <Pressable
          className="flex-1 items-center justify-center px-10"
          style={{ backgroundColor: 'rgba(0,0,0,0.45)' }}
          onPress={() => setOpenedAt(null)}
        >
          <View className="w-full rounded-2xl p-5" style={{ backgroundColor: colors.surface }}>
            <FreshnessRow
              label="Positions"
              value={positions}
              detail="Shares and cost basis from your brokerage, through Plaid. Plaid checks in about once a day."
            />
            {prices ? (
              <>
                <View className="my-4 bg-border" style={{ height: 1 }} />
                <FreshnessRow
                  label={priceLabel}
                  value={prices}
                  detail="Stocks and ETFs use their latest trade on the market feed, up to 15 minutes delayed. Funds, bonds and cash use your brokerage's price."
                />
              </>
            ) : null}
          </View>
        </Pressable>
      </Modal>
    </>
  )
}

function FreshnessRow({ label, value, detail }: { label: string; value: string; detail: string }) {
  return (
    <View>
      <View className="flex-row items-baseline justify-between gap-3">
        <Text className="font-sansSemi text-base text-textPrimary">{label}</Text>
        <Text className="font-sansSemi text-base text-textPrimary">{value}</Text>
      </View>
      <Text className="mt-1 font-sans text-sm leading-5 text-textSecondary">{detail}</Text>
    </View>
  )
}
