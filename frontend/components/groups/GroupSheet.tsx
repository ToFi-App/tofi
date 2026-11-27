import { useCallback, useEffect, useMemo, useState } from 'react'
import { describeGroupError } from '@/lib/groups/groupErrors'
import { reportError } from '@/lib/observability/log'
import { Alert, Platform, Pressable, ScrollView, Text, TextInput, View } from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import { BottomSheet, useSheetScroll } from '@/components/ui/BottomSheet'
import { SheetHeader } from '@/components/ui/SheetHeader'
import { Button } from '@/components/ui/Button'
import { ErrorBanner } from '@/components/ui/ErrorBanner'
import { CategoryIcon } from '@/components/categories/CategoryIcon'
import { DayGroupedTransactions } from '@/components/transactions/DayGroupedTransactions'
import { useTransactionEditorActions } from '@/components/transactions/TransactionEditorProvider'
import { useTransactionFeed } from '@/hooks/useTransactionFeed'
import { useTransactionGroups } from '@/hooks/useTransactionGroups'
import { colors, fontSize, hexToRgba, shadow } from '@/constants/theme'
import { formatAmount } from '@/lib/format/money'
import { formatDayLabel } from '@/lib/format/date'
import { groupByDay } from '@/lib/transactions/groupByDay'
import { amountSign, transactionAmountColor } from '@/lib/transactions/amountDisplay'
import {
  memberRefFor,
  pickerCandidates,
  summarizeGroup,
  transactionCountLabel,
  type PickerCandidate,
} from '@/lib/groups/groups'
import type { FeedItem } from '@/lib/transactions/resolveFeed'

/** How many picker rows to draw before "Show more": a year of feed is thousands of rows. */
const PICKER_PAGE = 60

/**
 * A group's page (docs/transaction-groups.md §5), as a sheet over the Calendar — the way category
 * and account details open — with the add-transactions picker pushed inside it (§4).
 */
export function GroupSheet({ groupId, onClose }: { groupId: string | null; onClose: () => void }) {
  const sheetScroll = useSheetScroll()
  const [view, setView] = useState<'detail' | 'pick'>('detail')
  // A fresh group (just created from the "+" menu) has nothing to show yet, so its sheet opens
  // straight on the empty state, whose one action is the picker.
  useEffect(() => {
    if (groupId) setView('detail')
  }, [groupId])

  const groups = useTransactionGroups()
  const group = groupId ? groups.groupById.get(groupId) ?? null : null

  return (
    <BottomSheet visible={group != null} onClose={onClose} contentScroll={sheetScroll}>
      {group ? (
        view === 'detail' ? (
          <GroupDetail groupId={group.id} onClose={onClose} onAdd={() => setView('pick')} />
        ) : (
          <GroupPicker groupId={group.id} onClose={onClose} onBack={() => setView('detail')} />
        )
      ) : null}
    </BottomSheet>
  )
}

function GroupDetail({ groupId, onClose, onAdd }: { groupId: string; onClose: () => void; onAdd: () => void }) {
  const { feed, categoryById } = useTransactionFeed()
  const groups = useTransactionGroups()
  const { openTransaction } = useTransactionEditorActions()
  const [error, setError] = useState<string | null>(null)
  const group = groups.groupById.get(groupId)
  const feedById = useMemo(() => new Map(feed.map((item) => [item.id, item])), [feed])
  const summary = useMemo(
    () => (group ? summarizeGroup(group, groups.members, feedById) : null),
    [group, groups.members, feedById],
  )

  const categoryFor = useCallback(
    (item: FeedItem) => {
      const category = item.categoryId ? categoryById.get(item.categoryId) : undefined
      return { name: category?.name ?? 'Uncategorized', color: category?.color ?? colors.textMuted, icon: category?.icon ?? null }
    },
    [categoryById],
  )
  const reimbursementCategoryNameFor = useCallback(
    (item: FeedItem) => (item.reimbursementCategoryId ? (categoryById.get(item.reimbursementCategoryId)?.name ?? null) : null),
    [categoryById],
  )

  if (!group || !summary) return null

  async function run(action: () => Promise<unknown>, failure: string) {
    setError(null)
    try {
      await action()
    } catch (err) {
      reportError('group-action', err)
      setError(describeGroupError(err, failure))
    }
  }

  function openMenu() {
    if (!group) return
    const rename = () =>
      Alert.prompt?.(
        'Rename group',
        undefined,
        (name) => {
          const trimmed = name?.trim()
          if (trimmed) void run(() => groups.update({ id: group.id, name: trimmed }), "Couldn't rename the group.")
        },
        'plain-text',
        group.name,
      )
    const remove = () =>
      Alert.alert('Delete group?', 'The transactions stay; only the group goes.', [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () =>
            void run(async () => {
              await groups.delete({ id: group.id })
              onClose()
            }, "Couldn't delete the group."),
        },
      ])
    Alert.alert(group.name, undefined, [
      ...(Platform.OS === 'ios' ? [{ text: 'Rename', onPress: rename }] : []),
      { text: 'Delete group', style: 'destructive' as const, onPress: remove },
      { text: 'Cancel', style: 'cancel' as const },
    ])
  }

  const isEmpty = summary.items.length === 0

  return (
    <>
      <SheetHeader
        title={group.name}
        onClose={onClose}
        right={
          <Pressable onPress={openMenu} hitSlop={8} accessibilityRole="button" accessibilityLabel="Group options">
            <Ionicons name="ellipsis-horizontal" size={22} color={colors.textPrimary} />
          </Pressable>
        }
      />
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 32 }}>
        <View className="gap-4 px-5">
          <View className="flex-row items-center justify-center gap-2">
            <StatusPill resolved={summary.resolved} />
            <Text className="font-sansMed text-sm text-textSecondary">{transactionCountLabel(summary.items.length)}</Text>
          </View>

          {error ? <ErrorBanner message={error} onDismiss={() => setError(null)} /> : null}

          {/* The same Income / Expenses / Balance row the Calendar shows under its month grid. */}
          <View className="flex-row justify-between rounded-xl bg-surface px-5 py-3" style={shadow.sm}>
            <View className="items-start">
              <Text className="font-sansMed text-xs text-textPrimary">Income</Text>
              <Text className="font-display text-md text-income">{formatAmount(summary.in)}</Text>
            </View>
            <View className="items-center">
              <Text className="font-sansMed text-xs text-textPrimary">Expenses</Text>
              <Text className="font-display text-md text-expense">{formatAmount(summary.out)}</Text>
            </View>
            <View className="items-end">
              <Text className="font-sansMed text-xs text-textPrimary">Balance</Text>
              <Text className="font-display text-md text-textPrimary">{formatAmount(summary.net)}</Text>
            </View>
          </View>

          {isEmpty ? (
            <View className="items-center gap-3 rounded-xl bg-surface px-6 py-8" style={shadow.sm}>
              <View
                className="h-14 w-14 items-center justify-center rounded-lg"
                style={{ backgroundColor: hexToRgba(group.color, 0.18) }}
              >
                <Ionicons name="albums-outline" size={26} color={group.color} />
              </View>
              <Text className="font-sansSemi text-base text-textPrimary">No transactions yet</Text>
              <Text className="text-center font-sans text-sm text-textSecondary">
                Add the expenses from this trip and the Venmos that pay you back.
              </Text>
              <View className="mt-1 self-stretch">
                <Button label="Add transactions" onPress={onAdd} />
              </View>
            </View>
          ) : null}
        </View>

        {!isEmpty ? (
          <View className="mt-4">
            <DayGroupedTransactions
              items={summary.items}
              cardClassName="mx-5 mb-3 rounded-xl bg-surface px-4"
              categoryFor={categoryFor}
              reimbursementCategoryNameFor={reimbursementCategoryNameFor}
              onItemPress={openTransaction}
            />
            <View className="flex-row gap-3 px-5 pt-1">
              <View className="flex-1">
                <Button label="Add transactions" variant="secondary" onPress={onAdd} />
              </View>
              <View className="flex-1">
                <Button
                  label={summary.resolved ? 'Reopen' : 'Mark resolved'}
                  variant={summary.resolved ? 'secondary' : 'primary'}
                  loading={groups.isSaving}
                  onPress={() =>
                    void run(
                      () => (summary.resolved ? groups.reopen({ id: group.id }) : groups.resolve({ id: group.id })),
                      summary.resolved ? "Couldn't reopen the group." : "Couldn't mark the group resolved.",
                    )
                  }
                />
              </View>
            </View>
          </View>
        ) : null}
      </ScrollView>
    </>
  )
}

/** Amber while money is still out, teal once settled — the app's own on-track/approaching hues. */
function StatusPill({ resolved }: { resolved: boolean }) {
  const color = resolved ? colors.primary : colors.warning
  return (
    <View className="rounded-full px-2 py-0.5" style={{ backgroundColor: hexToRgba(color, 0.14) }}>
      <Text className="font-sansSemi text-xs" style={{ color }}>
        {resolved ? 'Resolved' : 'Active'}
      </Text>
    </View>
  )
}

function GroupPicker({ groupId, onClose, onBack }: { groupId: string; onClose: () => void; onBack: () => void }) {
  const { feed, categoryById } = useTransactionFeed()
  const groups = useTransactionGroups()
  const group = groups.groupById.get(groupId)
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState<Set<string>>(() => new Set())
  const [limit, setLimit] = useState(PICKER_PAGE)
  const [error, setError] = useState<string | null>(null)

  const candidates = useMemo(() => pickerCandidates(feed, groupId, groups.members, query), [feed, groupId, groups.members, query])
  const shown = useMemo(() => candidates.slice(0, limit), [candidates, limit])
  const days = useMemo(() => {
    const byItem = new Map(shown.map((c) => [c.item.id, c]))
    return groupByDay(shown.map((c) => c.item)).map((day) => ({ date: day.date, rows: day.items.map((i) => byItem.get(i.id)!) }))
  }, [shown])

  const selectedItems = useMemo(() => candidates.filter((c) => selected.has(c.item.id)).map((c) => c.item), [candidates, selected])
  const totals = useMemo(() => {
    let out = 0
    let income = 0
    for (const item of selectedItems) {
      if (item.amount > 0) out += item.amount
      else income += -item.amount
    }
    return { out, in: income }
  }, [selectedItems])

  const toggle = useCallback((id: string) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }, [])

  async function add() {
    setError(null)
    try {
      await groups.addMembers({ groupId, members: selectedItems.map(memberRefFor) })
      onBack()
    } catch (err) {
      reportError('group-add-members', err)
      setError(describeGroupError(err, "Couldn't add these. One may already be in another group."))
    }
  }

  if (!group) return null
  const now = Date.now()
  const count = selectedItems.length

  return (
    <View style={{ flexShrink: 1 }}>
      <SheetHeader title={`Add to ${group.name}`} onClose={onClose} onBack={onBack} />
      <View className="px-5 pb-3">
        <View
          className="flex-row items-center gap-2 rounded-md bg-surface px-3"
          style={{ height: 44, borderWidth: 1, borderColor: colors.border }}
        >
          <Ionicons name="search" size={16} color={colors.textSecondary} />
          <TextInput
            value={query}
            onChangeText={(text) => {
              setQuery(text)
              setLimit(PICKER_PAGE)
            }}
            placeholder="Search transactions"
            placeholderTextColor={colors.textMuted}
            accessibilityLabel="Search transactions"
            autoCorrect={false}
            style={{ flex: 1, fontSize: fontSize.base, color: colors.textPrimary }}
          />
        </View>
      </View>

      <ScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingBottom: 12 }}>
        {days.length === 0 ? (
          <Text className="px-5 py-8 text-center font-sans text-sm text-textSecondary">
            {query ? 'No matching transactions' : 'No transactions to add'}
          </Text>
        ) : (
          days.map((day) => (
            <View key={day.date} className="mx-5 mb-3 rounded-xl bg-surface px-4" style={shadow.sm}>
              <Text className="pb-1 pt-3 font-sansSemi text-sm text-textPrimary">{formatDayLabel(day.date, now)}</Text>
              {day.rows.map((candidate) => (
                <PickerRow
                  key={candidate.item.id}
                  candidate={candidate}
                  checked={selected.has(candidate.item.id)}
                  onToggle={toggle}
                  otherGroupName={candidate.otherGroupId ? groups.groupById.get(candidate.otherGroupId)?.name ?? null : null}
                  categoryName={candidate.item.categoryId ? categoryById.get(candidate.item.categoryId)?.name ?? 'Uncategorized' : 'Uncategorized'}
                  categoryIcon={candidate.item.categoryId ? categoryById.get(candidate.item.categoryId)?.icon ?? null : null}
                  categoryColor={candidate.item.categoryId ? categoryById.get(candidate.item.categoryId)?.color ?? colors.textMuted : colors.textMuted}
                />
              ))}
            </View>
          ))
        )}
        {candidates.length > shown.length ? (
          <View className="px-5">
            <Button label="Show more" variant="ghost" onPress={() => setLimit((n) => n + PICKER_PAGE)} />
          </View>
        ) : null}
      </ScrollView>

      <View className="gap-2 border-t bg-surface px-5 pb-8 pt-3" style={{ borderColor: colors.border }}>
        {error ? <ErrorBanner message={error} onDismiss={() => setError(null)} /> : null}
        {count > 0 ? (
          // Two figures, two Text elements: design.md bans joining them with a dot.
          <View className="flex-row justify-center gap-4">
            <Text className="font-sansMed text-sm text-expense">{formatAmount(totals.out)} out</Text>
            <Text className="font-sansMed text-sm text-income">{formatAmount(totals.in)} in</Text>
          </View>
        ) : null}
        <Button
          label={count === 0 ? 'Select transactions' : `Add ${transactionCountLabel(count)}`}
          onPress={() => void add()}
          disabled={count === 0}
          loading={groups.isSaving}
        />
      </View>
    </View>
  )
}

function PickerRow({
  candidate,
  checked,
  onToggle,
  otherGroupName,
  categoryName,
  categoryIcon,
  categoryColor,
}: {
  candidate: PickerCandidate
  checked: boolean
  onToggle: (id: string) => void
  otherGroupName: string | null
  categoryName: string
  categoryIcon: string | null
  categoryColor: string
}) {
  const { item } = candidate
  const disabled = otherGroupName != null
  return (
    <Pressable
      onPress={() => onToggle(item.id)}
      disabled={disabled}
      accessibilityRole="checkbox"
      accessibilityState={{ checked, disabled }}
      className="flex-row items-center gap-3 border-t py-3"
      style={{ borderColor: colors.border, opacity: disabled ? 0.45 : 1 }}
    >
      <View
        className="h-6 w-6 items-center justify-center rounded-full"
        style={checked ? { backgroundColor: colors.primary } : { borderWidth: 2, borderColor: colors.borderStrong }}
      >
        {checked ? <Ionicons name="checkmark" size={14} color={colors.textInverse} /> : null}
      </View>
      <View className="h-8 w-8 items-center justify-center rounded-full" style={{ backgroundColor: hexToRgba(categoryColor, 0.18) }}>
        <CategoryIcon icon={categoryIcon} size={15} color={categoryColor} />
      </View>
      <View className="flex-1 gap-0.5">
        <Text className="font-sansMed text-base text-textPrimary" numberOfLines={1}>
          {item.note ?? item.merchantName}
        </Text>
        <Text className="font-sans text-sm text-textSecondary" numberOfLines={1}>
          {otherGroupName ? `In ${otherGroupName}` : categoryName}
        </Text>
      </View>
      <Text className="font-mono text-base" style={{ color: transactionAmountColor(item) }}>
        {amountSign(item)}
        {formatAmount(Math.abs(item.amount))}
      </Text>
    </Pressable>
  )
}

