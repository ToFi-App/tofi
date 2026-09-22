import { useEffect, useMemo, useState } from 'react'
import { Pressable, ScrollView, Text, TextInput, View } from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import { colors, hexToRgba } from '@/constants/theme'
import type { SheetScroll } from '@/components/ui/BottomSheet'
import { Button } from '@/components/ui/Button'
import { formatAmount } from '@/lib/format/money'
import { TRANSFER_TYPE_LIST, daysBetween } from '@/lib/transfers/registry'
import { remainingExpense, searchReimbursementCandidates, suggestReimbursements } from '@/lib/reimbursements/suggest'
import type { FeedItem } from '@/lib/transactions/resolveFeed'
import type { Account, TransferKind } from '@/types/domain'

interface TransferSheetProps {
  /** Owned by the single sheet host, so drag-to-dismiss tracks whichever content is showing. */
  sheetScroll: SheetScroll
  item: FeedItem | null
  candidateItems: FeedItem[]
  accounts: Account[]
  forcedKind?: TransferKind
  onClose: () => void
  /**
   * Hands the choice back rather than writing it: nothing reaches the server until the sheet this
   * came from is saved. That's why there's no saving state here — the spinner belongs to whichever
   * sheet owns the write.
   */
  onSave: (input: { kind: TransferKind; counterpartIds: string[] }) => void
}

export function TransferSheet({ sheetScroll, item, candidateItems, accounts, forcedKind, onClose, onSave }: TransferSheetProps) {
  const applicableTypes = useMemo(
    () => (item ? TRANSFER_TYPE_LIST.filter((type) => type.kind !== 'reimbursement' && type.appliesTo(item, { accounts })) : []),
    [item, accounts],
  )

  const [kindOverride, setKindOverride] = useState<TransferKind | null>(null)
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [searchQuery, setSearchQuery] = useState('')

  useEffect(() => {
    setKindOverride(null)
    setSelectedIds([])
    setSearchQuery('')
  }, [item?.id])

  const kind = forcedKind ?? kindOverride ?? applicableTypes[0]?.kind ?? null
  const selectedType = kind ? (forcedKind ? TRANSFER_TYPE_LIST.find((t) => t.kind === kind) ?? null : applicableTypes.find((type) => type.kind === kind) ?? null) : null
  const isReimbursement = selectedType?.kind === 'reimbursement'
  const isStartingFromExpense = (item?.amount ?? 0) > 0
  // The registry's single-select rule protects the income side (one income can't split across
  // expenses — no defined allocation). The expense side has no such ambiguity: several friends
  // paying back one bill is the normal case, so it multi-selects.
  const isMultiSelect = selectedType?.multiSelect === true || (isReimbursement && isStartingFromExpense)

  // Reset selection when switching kinds
  useEffect(() => {
    setSelectedIds([])
    setSearchQuery('')
  }, [kind])

  const matches = useMemo(() => {
    if (!item || !selectedType) return []

    if (selectedType.kind === 'reimbursement') {
      const selected = candidateItems.filter((candidate) => selectedIds.includes(candidate.id))
      const rest = candidateItems.filter((candidate) => !selectedIds.includes(candidate.id))
      let list: FeedItem[]
      if (searchQuery.trim()) {
        list = searchReimbursementCandidates(searchQuery, rest)
      } else if (item.amount > 0) {
        // Score against what's still owed, so linking the $60 makes the $20 surface next.
        const remaining = Math.max(0, remainingExpense(item) - selected.reduce((sum, c) => sum + Math.abs(c.amount), 0))
        list = suggestReimbursements(item, rest, { remainingOverride: remaining }).map((scored) => scored.item)
      } else {
        list = suggestReimbursements(item, rest).map((scored) => scored.item)
      }
      // Selections stay pinned on top: re-ranking against the shrinking remainder (or a new
      // search) must never make a ticked row vanish.
      return [...selected, ...list]
    }

    return candidateItems
      .filter((candidate) => selectedType.matches(item, candidate, { accounts }))
      .sort((a, b) => {
        const dayDelta = daysBetween(item.postedDate, a.postedDate) - daysBetween(item.postedDate, b.postedDate)
        if (dayDelta !== 0) return dayDelta
        const target = Math.abs(item.amount)
        return Math.abs(Math.abs(a.amount) - target) - Math.abs(Math.abs(b.amount) - target)
      })
  }, [item, selectedType, candidateItems, accounts, selectedIds, searchQuery])

  // Prune against the full candidate pool, not `matches`: for reimbursements the visible list
  // shifts under search and re-ranking, and a still-valid selection must survive that.
  useEffect(() => {
    setSelectedIds((prev) => prev.filter((id) => candidateItems.some((candidate) => candidate.id === id)))
  }, [candidateItems])

  if (!item || !selectedType) return null

  const canSave = selectedIds.length > 0 || selectedType.allowsUnpaired

  function toggleId(id: string) {
    setSelectedIds((prev) => {
      if (prev.includes(id)) return prev.filter((existing) => existing !== id)
      if (isMultiSelect) return [...prev, id]
      return [id]
    })
  }

  // A reimbursement pairs an expense with smaller-or-equal incomes, so the sheet shows what the
  // expense actually cost after the money that came back. Whichever side the user started from,
  // the expense leg and the incomes-total are read off the signs — and money already linked from
  // earlier reimbursements counts too, so the net line always shows the true remaining cost.
  const selectedItems = matches.filter((candidate) => selectedIds.includes(candidate.id))
  const expenseLeg = isReimbursement ? (isStartingFromExpense ? item : selectedItems[0] ?? null) : null
  const reimbursement =
    isReimbursement && expenseLeg && selectedItems.length > 0
      ? {
          expense: Math.abs(expenseLeg.amount),
          income:
            (expenseLeg.reimbursedAmount ?? 0) +
            (isStartingFromExpense ? selectedItems.reduce((sum, c) => sum + Math.abs(c.amount), 0) : Math.abs(item.amount)),
        }
      : null

  const listHeading = isReimbursement
    ? searchQuery.trim()
      ? 'Search results'
      : 'Suggested'
    : isStartingFromExpense
      ? 'Matching income'
      : 'Matching expense'

  return (
    <>
      <View className="flex-row items-center justify-between px-5 py-3">
        <Pressable onPress={onClose} hitSlop={8}>
          <Ionicons name="close" size={22} color={colors.textSecondary} />
        </Pressable>
        <Text className="font-display text-md text-textPrimary">Transfer</Text>
        <View style={{ width: 22 }} />
      </View>

      <ScrollView {...sheetScroll.scrollProps} className="px-5" contentContainerClassName="gap-4 pb-10" keyboardShouldPersistTaps="handled">
        <Text className={`font-mono text-base ${isStartingFromExpense ? 'text-expense' : 'text-income'}`}>
          {item.merchantName} {formatAmount(item.amount)}
        </Text>

        {forcedKind ? null : <View className="flex-row flex-wrap gap-2">
          {applicableTypes.map((type) => {
            const isSelected = type.kind === kind
            return (
              <Pressable
                key={type.kind}
                onPress={() => setKindOverride(type.kind)}
                accessibilityRole="button"
                accessibilityState={{ selected: isSelected }}
                className="flex-row items-center gap-2 rounded-full border px-3 py-2"
                style={{
                  borderColor: isSelected ? type.color : colors.border,
                  backgroundColor: isSelected ? hexToRgba(type.color, 0.12) : 'transparent',
                }}
              >
                <Ionicons name={type.icon} size={14} color={isSelected ? type.color : colors.textSecondary} />
                <Text className="font-sansMed text-sm" style={{ color: isSelected ? type.color : colors.textSecondary }}>
                  {type.label}
                </Text>
              </Pressable>
            )
          })}
        </View>}

        <Text className="font-display text-base text-textPrimary">{listHeading}</Text>

        {isReimbursement ? (
          <View className="flex-row items-center gap-2 rounded-lg border px-3 py-2" style={{ borderColor: colors.border }}>
            <Ionicons name="search" size={16} color={colors.textMuted} />
            <TextInput
              value={searchQuery}
              onChangeText={setSearchQuery}
              placeholder="Search all by amount or name"
              placeholderTextColor={colors.textMuted}
              autoCapitalize="none"
              autoCorrect={false}
              className="flex-1 py-0 font-sans text-sm text-textPrimary"
              accessibilityLabel="Search reimbursement candidates"
            />
            {searchQuery ? (
              <Pressable onPress={() => setSearchQuery('')} hitSlop={8} accessibilityLabel="Clear search">
                <Ionicons name="close-circle" size={16} color={colors.textMuted} />
              </Pressable>
            ) : null}
          </View>
        ) : null}

        {matches.length === 0 ? (
          <Text className="font-sans text-sm text-textMuted">
            {isReimbursement
              ? searchQuery.trim()
                ? 'Nothing matches that search.'
                : 'No likely matches — try searching by amount or name.'
              : `No matching ${isStartingFromExpense ? 'income' : 'expense'} found.`}
          </Text>
        ) : (
          matches.map((candidate) => {
            const isSelected = selectedIds.includes(candidate.id)
            const daysApart = daysBetween(item.postedDate, candidate.postedDate)
            return (
              <Pressable
                key={candidate.id}
                onPress={() => toggleId(candidate.id)}
                accessibilityRole="button"
                accessibilityState={{ selected: isSelected }}
                className="flex-row items-center justify-between rounded-lg border px-3 py-3"
                style={{
                  borderColor: isSelected ? selectedType.color : colors.border,
                  backgroundColor: isSelected ? hexToRgba(selectedType.color, 0.1) : 'transparent',
                }}
              >
                <View className="flex-1 gap-0.5 pr-3">
                  <Text className="font-sans text-base text-textPrimary" numberOfLines={1}>
                    {candidate.merchantName}
                  </Text>
                  <Text className="font-sans text-xs text-textMuted">
                    {candidate.date}
                    {daysApart === 0 ? ' · same day' : ` · ${daysApart} day${daysApart === 1 ? '' : 's'} apart`}
                  </Text>
                </View>
                <Text className={`font-mono text-sm ${candidate.amount > 0 ? 'text-expense' : 'text-income'}`}>
                  {formatAmount(Math.abs(candidate.amount))}
                </Text>
                {isSelected ? (
                  <Ionicons name="checkmark-circle" size={18} color={selectedType.color} style={{ marginLeft: 8 }} />
                ) : null}
              </Pressable>
            )
          })
        )}

        {reimbursement ? (
          <Text className="font-sans text-base text-textPrimary">
            Net expense: {formatAmount(reimbursement.expense)} − {formatAmount(reimbursement.income)} ={' '}
            <Text className="font-mono text-expense">
              {formatAmount(Math.max(0, reimbursement.expense - reimbursement.income))}
            </Text>
          </Text>
        ) : null}

        <Button
          label={selectedIds.length > 0 ? (isReimbursement ? 'Save Reimbursement' : 'Save Transfer') : 'Save without match'}
          onPress={() => onSave({ kind: selectedType.kind, counterpartIds: selectedIds })}
          disabled={!canSave}
        />
      </ScrollView>
    </>
  )
}
