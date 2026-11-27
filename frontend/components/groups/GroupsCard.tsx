import { memo } from 'react'
import { Pressable, Text, View } from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import { colors, shadow } from '@/constants/theme'
import { formatAmount } from '@/lib/format/money'
import { transactionCountLabel, type GroupSummary } from '@/lib/groups/groups'
import { GroupIcon } from './GroupIcon'

/**
 * The Calendar's Groups card: every ACTIVE group, whatever month is on screen, since an open trip
 * is a to-do until the user resolves it. Not rendered at all when there are none — creating a
 * group lives in the "+" menu, so an empty card would only take up a row.
 *
 * Totals are the whole group's, never the visible month's slice.
 */
function GroupsCardComponent({ summaries, onOpen }: { summaries: GroupSummary[]; onOpen: (groupId: string) => void }) {
  if (summaries.length === 0) return null
  return (
    <View className="mx-5 mb-3 rounded-xl bg-surface px-4" style={shadow.sm}>
      <View className="pb-1 pt-3">
        <Text className="font-sansSemi text-base text-textPrimary">Groups</Text>
      </View>
      {summaries.map((summary) => (
        <Pressable
          key={summary.group.id}
          onPress={() => onOpen(summary.group.id)}
          accessibilityRole="button"
          accessibilityLabel={`${summary.group.name}, ${transactionCountLabel(summary.items.length)}, ${formatAmount(summary.net)}`}
          className="flex-row items-center gap-3 border-t py-3 active:opacity-70"
          style={{ borderColor: colors.border }}
        >
          <GroupIcon color={summary.group.color} icon={summary.group.icon} />
          <View className="flex-1 gap-0.5">
            <Text className="font-sansSemi text-base text-textPrimary" numberOfLines={1}>
              {summary.group.name}
            </Text>
            <Text className="font-sans text-sm text-textSecondary" numberOfLines={1}>
              {transactionCountLabel(summary.items.length)}
            </Text>
          </View>
          <Text
            className="font-mono text-base"
            style={{ color: summary.net < 0 ? colors.expense : summary.net > 0 ? colors.income : colors.textPrimary }}
          >
            {summary.net > 0 ? '+' : ''}
            {formatAmount(summary.net)}
          </Text>
          <Ionicons name="chevron-forward" size={16} color={colors.textSecondary} />
        </Pressable>
      ))}
    </View>
  )
}

export const GroupsCard = memo(GroupsCardComponent)
