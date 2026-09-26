import { Pressable, Text, View } from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import { AccountMarkChip } from '@/components/accounts/AccountMarkChip'
import { colors } from '@/constants/theme'
import { useAccountMarks } from '@/hooks/useAccountMarks'
import { formatDayLabel } from '@/lib/format/date'
import { formatMaskableAmount } from '@/lib/format/money'
import { TRANSFER_TYPES } from '@/lib/transfers/registry'
import type { LegPair } from '@/lib/transfers/pairLegs'
import type { FeedItem } from '@/lib/transactions/resolveFeed'

interface TransferPairCardProps {
  pair: LegPair
  accountName: (accountId: string | null) => string
  isMasked: boolean
  onLegPress: (item: FeedItem) => void
}

function Leg({ item, direction, isMasked, onPress }: { item: FeedItem; direction: 'out' | 'in'; isMasked: boolean; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} className="flex-row items-center gap-2 py-1.5">
      <Text className="font-sans text-xs text-textMuted" style={{ width: 64 }}>
        {formatDayLabel(item.date, Date.now())}
      </Text>
      <Text className="flex-1 font-sans text-xs text-textSecondary" numberOfLines={1}>
        {item.merchantName}
      </Text>
      <Text className="font-mono text-xs" style={{ color: direction === 'out' ? colors.expense : colors.income }}>
        {direction === 'out' ? '−' : '+'}
        {formatMaskableAmount(Math.abs(item.amount), isMasked)}
      </Text>
      <Ionicons name="chevron-forward" size={12} color={colors.textMuted} />
    </Pressable>
  )
}

/**
 * One transfer as one card: where the money left, where it arrived, and the amount once, with the
 * two bank rows underneath as the evidence. Each leg is tappable, opening the usual editor.
 */
export function TransferPairCard({ pair, accountName, isMasked, onLegPress }: TransferPairCardProps) {
  const marks = useAccountMarks()
  const { outflow, inflow } = pair
  const type = outflow.transferKind ? TRANSFER_TYPES[outflow.transferKind] : null
  const mark = (item: FeedItem) => (item.accountId ? (marks.get(item.accountId) ?? null) : null)

  return (
    <View className="gap-2 rounded-xl bg-surface px-4 py-3">
      <View className="flex-row items-center gap-2">
        <AccountMarkChip mark={mark(outflow)} ringColor={colors.border} size={16} />
        <Text className="font-sansSemi text-sm text-textPrimary" numberOfLines={1} style={{ flexShrink: 1 }}>
          {accountName(outflow.accountId)}
        </Text>
        <Ionicons name="arrow-forward" size={14} color={colors.textMuted} />
        <AccountMarkChip mark={mark(inflow)} ringColor={colors.border} size={16} />
        <Text className="font-sansSemi text-sm text-textPrimary" numberOfLines={1} style={{ flexShrink: 1 }}>
          {accountName(inflow.accountId)}
        </Text>
      </View>

      <View className="flex-row items-center justify-between">
        {type ? (
          <View className="rounded-full px-2 py-0.5" style={{ backgroundColor: colors.primaryMuted }}>
            <Text className="font-sansMed text-xs" style={{ color: colors.transfer }}>
              {outflow.transferSource === 'auto' ? `${type.shortLabel} · Auto` : type.shortLabel}
            </Text>
          </View>
        ) : (
          <View />
        )}
        <Text className="font-display text-md text-textPrimary">{formatMaskableAmount(Math.abs(outflow.amount), isMasked)}</Text>
      </View>

      <View style={{ borderTopWidth: 1, borderTopColor: colors.border }}>
        <Leg item={outflow} direction="out" isMasked={isMasked} onPress={() => onLegPress(outflow)} />
        <Leg item={inflow} direction="in" isMasked={isMasked} onPress={() => onLegPress(inflow)} />
      </View>
    </View>
  )
}
