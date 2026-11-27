import { useState } from 'react'
import { describeGroupError } from '@/lib/groups/groupErrors'
import { reportError } from '@/lib/observability/log'
import { Pressable, Text, View } from 'react-native'
import { colors, hexToRgba } from '@/constants/theme'
import { useTransactionGroups } from '@/hooks/useTransactionGroups'
import type { MemberRef } from '@/lib/groups/groups'

/**
 * The transaction sheets' Group field: put this one transaction in a group, move it, or take it
 * out — the easy way to add a Venmo that arrives after the trip. Chips like the subcategory row
 * above it, and applied on tap rather than with the sheet's Save: membership is its own write,
 * independent of the category edits Save commits.
 *
 * Offers the active groups, plus the transaction's own group if that one is resolved, so it can
 * still be taken out. Renders nothing when there are no groups to offer.
 */
export function GroupField({ itemId, memberRef }: { itemId: string; memberRef: MemberRef }) {
  const groups = useTransactionGroups()
  const [error, setError] = useState<string | null>(null)
  const currentGroupId = groups.groupIdByItem.get(itemId) ?? null
  const options = groups.groups.filter((g) => g.resolvedAt === null || g.id === currentGroupId)
  if (options.length === 0) return null

  async function choose(groupId: string | null) {
    if (groupId === currentGroupId) return
    setError(null)
    try {
      if (currentGroupId) {
        const member = groups.members.find((m) => m.groupId === currentGroupId && (m.plaidTransactionId ?? m.manualTransactionId) === itemId)
        if (member) await groups.removeMembers({ groupId: currentGroupId, memberIds: [member.id] })
      }
      if (groupId) await groups.addMembers({ groupId, members: [memberRef] })
    } catch (err) {
      reportError('group-field', err)
      setError(describeGroupError(err, "Couldn't update the group."))
    }
  }

  return (
    <View className="gap-2">
      <Text className="font-sansMed text-sm text-textSecondary">Group</Text>
      <View className="flex-row flex-wrap gap-2">
        <Chip label="None" selected={currentGroupId === null} color={colors.primary} onPress={() => void choose(null)} disabled={groups.isSaving} />
        {options.map((group) => (
          <Chip
            key={group.id}
            label={group.name}
            selected={group.id === currentGroupId}
            color={group.color}
            onPress={() => void choose(group.id)}
            disabled={groups.isSaving}
          />
        ))}
      </View>
      {error ? <Text className="font-sans text-sm text-expense">{error}</Text> : null}
    </View>
  )
}

function Chip({ label, selected, color, onPress, disabled }: { label: string; selected: boolean; color: string; onPress: () => void; disabled: boolean }) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="radio"
      accessibilityState={{ selected, disabled }}
      className="rounded-full border px-3 py-2"
      style={{
        borderColor: selected ? color : colors.border,
        backgroundColor: selected ? hexToRgba(color, 0.12) : 'transparent',
      }}
    >
      <Text className="font-sansMed text-sm" style={{ color: selected ? color : colors.textSecondary }}>
        {label}
      </Text>
    </Pressable>
  )
}
