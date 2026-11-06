import { useEffect, useMemo, useState } from 'react'
import { Pressable, ScrollView, Text, TextInput, View } from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import Animated, { FadeInDown, FadeOutDown } from 'react-native-reanimated'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { colors, hexToRgba } from '@/constants/theme'
import type { SheetScroll } from '@/components/ui/BottomSheet'
import { Button } from '@/components/ui/Button'
import { formatAmount } from '@/lib/format/money'
import { TRANSFER_TYPE_LIST, daysBetween } from '@/lib/transfers/registry'
import { remainingExpense, remainingIncome, searchReimbursementCandidates, suggestReimbursements } from '@/lib/reimbursements/suggest'
import { checkSplit, parseShare, suggestShare } from '@/lib/reimbursements/split'
import type { FeedItem } from '@/lib/transactions/resolveFeed'
import type { Account, TransferKind } from '@/types/domain'
import { SheetHeader } from '@/components/ui/SheetHeader'

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
   * sheet owns the write. `amounts` is only set for a split: each charge's share of the income.
   */
  onSave: (input: { kind: TransferKind; counterpartIds: string[]; amounts?: Record<string, number> }) => void
}

export function TransferSheet({ sheetScroll, item, candidateItems, accounts, forcedKind, onClose, onSave }: TransferSheetProps) {
  const applicableTypes = useMemo(
    () => (item ? TRANSFER_TYPE_LIST.filter((type) => type.kind !== 'reimbursement' && type.appliesTo(item, { accounts })) : []),
    [item, accounts],
  )

  const insets = useSafeAreaInsets()
  const [kindOverride, setKindOverride] = useState<TransferKind | null>(null)
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [searchQuery, setSearchQuery] = useState('')
  // Splitting one income across several charges. Off by default, so picking one charge records the
  // whole income against it exactly as before; on, the list multi-selects and each pick gets a share.
  const [isSplit, setIsSplit] = useState(false)
  const [shares, setShares] = useState<Record<string, string>>({})

  useEffect(() => {
    setKindOverride(null)
    setSelectedIds([])
    setSearchQuery('')
    setIsSplit(false)
    setShares({})
  }, [item?.id])

  const kind = forcedKind ?? kindOverride ?? applicableTypes[0]?.kind ?? null
  const selectedType = kind ? (forcedKind ? TRANSFER_TYPE_LIST.find((t) => t.kind === kind) ?? null : applicableTypes.find((type) => type.kind === kind) ?? null) : null
  const isReimbursement = selectedType?.kind === 'reimbursement'
  const isStartingFromExpense = (item?.amount ?? 0) > 0
  // Only the income side splits: it's the one money that gets divided. The expense side already
  // takes several incomes, and an income with money left from an earlier split offers just that.
  const canSplit = isReimbursement && !isStartingFromExpense
  const isSplitting = canSplit && isSplit
  // The expense side multi-selects (several friends paying one bill back is the normal case); the
  // income side does once it's splitting. Otherwise one income pays back one expense.
  const isMultiSelect = selectedType?.multiSelect === true || (isReimbursement && isStartingFromExpense) || isSplitting
  const incomeAvailable = item && canSplit ? remainingIncome(item) : 0

  // Reset selection when switching kinds
  useEffect(() => {
    setSelectedIds([])
    setSearchQuery('')
    setIsSplit(false)
    setShares({})
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
        const remaining = Math.max(0, remainingExpense(item) - selected.reduce((sum, c) => sum + remainingIncome(c), 0))
        list = suggestReimbursements(item, rest, { remainingOverride: remaining }).map((scored) => scored.item)
      } else {
        list = suggestReimbursements(item, rest).map((scored) => scored.item)
      }
      // Selections stay pinned on top: re-ranking against the shrinking remainder (or a new
      // search) must never make a ticked row vanish.
      return [...selected, ...list]
    }

    // The other kinds pair whole transactions, so an income already paying something back —
    // offered only for the rest of it — doesn't belong here.
    return candidateItems
      .filter((candidate) => !candidate.isReimbursementIncome && selectedType.matches(item, candidate, { accounts }))
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

  const candidateById = new Map(candidateItems.map((candidate) => [candidate.id, candidate]))

  /** What's left of the income for a new pick: everything not already given to another share. */
  function incomeLeftExcept(id: string | null): number {
    return selectedIds.reduce((left, selected) => (selected === id ? left : left - (parseShare(shares[selected] ?? '') ?? 0)), incomeAvailable)
  }

  function toggleId(id: string) {
    if (selectedIds.includes(id)) {
      setSelectedIds((prev) => prev.filter((existing) => existing !== id))
      setShares(({ [id]: _removed, ...rest }) => rest)
      return
    }
    if (isSplitting) {
      // Each pick starts at what the charge still owes, or what's left of the income if that's less.
      const candidate = candidateById.get(id)
      if (candidate) setShares((prev) => ({ ...prev, [id]: suggestShare(candidate, incomeLeftExcept(id)).toFixed(2) }))
    }
    setSelectedIds((prev) => (isMultiSelect ? [...prev, id] : [id]))
  }

  function setSplitting(next: boolean) {
    setIsSplit(next)
    if (next) {
      // Whatever was picked becomes the first share, so turning split on never loses a choice.
      const first = selectedIds[0]
      const candidate = first ? candidateById.get(first) : undefined
      setShares(candidate ? { [candidate.id]: suggestShare(candidate, incomeAvailable).toFixed(2) } : {})
    } else {
      // Back to one charge: the first pick stays, and it takes the whole income again.
      setSelectedIds((prev) => prev.slice(0, 1))
      setShares({})
    }
  }

  // A reimbursement pairs an expense with smaller-or-equal incomes, so the sheet shows what the
  // expense actually cost after the money that came back. Whichever side the user started from,
  // the expense leg and the incomes-total are read off the signs — and money already linked from
  // earlier reimbursements counts too, so the net line always shows the true remaining cost.
  const selectedItems = matches.filter((candidate) => selectedIds.includes(candidate.id))
  const expenseLeg = isReimbursement ? (isStartingFromExpense ? item : selectedItems[0] ?? null) : null
  const reimbursement =
    isReimbursement && !isSplitting && expenseLeg && selectedItems.length > 0
      ? {
          expense: Math.abs(expenseLeg.amount),
          income:
            (expenseLeg.reimbursedAmount ?? 0) +
            (isStartingFromExpense ? selectedItems.reduce((sum, c) => sum + remainingIncome(c), 0) : remainingIncome(item)),
        }
      : null

  const split = isSplitting
    ? checkSplit(
        incomeAvailable,
        selectedItems.map((expense) => ({ expense, share: parseShare(shares[expense.id] ?? '') })),
      )
    : null

  const canSave = selectedIds.length > 0 && (split ? split.isValid : true)

  function handleSave() {
    if (!selectedType || !canSave) return
    if (split) {
      const amounts: Record<string, number> = {}
      for (const id of selectedIds) amounts[id] = parseShare(shares[id] ?? '') ?? 0
      onSave({ kind: selectedType.kind, counterpartIds: selectedIds, amounts })
    } else {
      onSave({ kind: selectedType.kind, counterpartIds: selectedIds })
    }
  }

  const listHeading = isReimbursement
    ? searchQuery.trim()
      ? 'Search results'
      : 'Suggested'
    : isStartingFromExpense
      ? 'Matching income'
      : 'Matching expense'

  const accent = selectedType.color

  return (
    <>
      <SheetHeader title="Transfer" onClose={onClose} />

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

        {/* The split control sits on the list's heading: it changes how the list below is picked
            from, and it's out of the way for the usual one-charge case. */}
        <View className="flex-row items-center justify-between gap-3">
          <Text className="font-display text-base text-textPrimary">{listHeading}</Text>
          {canSplit ? (
            <Pressable
              onPress={() => setSplitting(!isSplitting)}
              accessibilityRole="switch"
              accessibilityState={{ checked: isSplitting }}
              accessibilityLabel="Split across several charges"
              hitSlop={6}
              className="flex-row items-center gap-1.5 rounded-full border px-3 py-1.5"
              style={{
                borderColor: isSplitting ? accent : colors.border,
                backgroundColor: isSplitting ? hexToRgba(accent, 0.12) : 'transparent',
              }}
            >
              <Ionicons name="git-branch-outline" size={14} color={isSplitting ? accent : colors.textPrimary} />
              <Text className="font-sansMed text-sm" style={{ color: isSplitting ? accent : colors.textPrimary }}>
                Split
              </Text>
            </Pressable>
          ) : null}
        </View>

        {isSplitting ? (
          <Text className="-mt-2 font-sans text-sm text-textPrimary">
            Pick each charge this paid toward, then set how much of the {formatAmount(incomeAvailable)} went to each.
          </Text>
        ) : null}

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
            // An income an earlier split already drew on is offered for what it has left.
            const incomeLeftover = candidate.isReimbursementIncome ? remainingIncome(candidate) : null
            const shownAmount = incomeLeftover ?? Math.abs(candidate.amount)
            const shareError = split?.rowErrors[candidate.id]
            return (
              <Pressable
                key={candidate.id}
                onPress={() => toggleId(candidate.id)}
                accessibilityRole="button"
                accessibilityState={{ selected: isSelected }}
                className="rounded-lg border px-3 py-3"
                style={{
                  borderColor: isSelected ? accent : colors.border,
                  backgroundColor: isSelected ? hexToRgba(accent, 0.1) : 'transparent',
                }}
              >
                <View className="flex-row items-center justify-between">
                  <View className="flex-1 gap-0.5 pr-3">
                    <Text className="font-sans text-base text-textPrimary" numberOfLines={1}>
                      {candidate.merchantName}
                    </Text>
                    <Text className="font-sans text-xs text-textMuted">
                      {candidate.date}
                      {daysApart === 0 ? ' · same day' : ` · ${daysApart} day${daysApart === 1 ? '' : 's'} apart`}
                      {incomeLeftover != null ? ` · left of ${formatAmount(Math.abs(candidate.amount))}` : ''}
                    </Text>
                  </View>
                  <Text className={`font-mono text-sm ${candidate.amount > 0 ? 'text-expense' : 'text-income'}`}>
                    {formatAmount(shownAmount)}
                  </Text>
                  {isSelected ? (
                    <Ionicons name="checkmark-circle" size={18} color={accent} style={{ marginLeft: 8 }} />
                  ) : null}
                </View>

                {/* The share, right on the charge it belongs to. Typing in it doesn't unpick the
                    row: the field takes the touch, the card around it doesn't. */}
                {isSplitting && isSelected ? (
                  <View className="mt-3 gap-1 border-t pt-3" style={{ borderColor: hexToRgba(accent, 0.25) }}>
                    <View className="flex-row items-center justify-between gap-3">
                      <Text className="shrink font-sansMed text-sm text-textPrimary" numberOfLines={1}>
                        Toward this · {formatAmount(remainingExpense(candidate))} owed
                      </Text>
                      <View
                        className="flex-row items-center rounded-lg border px-2.5 py-1.5"
                        style={{ borderColor: shareError ? colors.expense : hexToRgba(accent, 0.45), backgroundColor: colors.surface }}
                      >
                        <Text className="font-mono text-base text-textPrimary">$</Text>
                        <TextInput
                          value={shares[candidate.id] ?? ''}
                          onChangeText={(text) => setShares((prev) => ({ ...prev, [candidate.id]: text }))}
                          keyboardType="decimal-pad"
                          selectTextOnFocus
                          placeholder="0.00"
                          placeholderTextColor={colors.textMuted}
                          accessibilityLabel={`Amount toward ${candidate.merchantName}`}
                          className="min-w-[64px] py-0 text-right font-mono text-base text-textPrimary"
                        />
                      </View>
                    </View>
                    {shareError ? (
                      <Text className="text-right font-sansMed text-xs" style={{ color: colors.expense }}>
                        {shareError}
                      </Text>
                    ) : null}
                  </View>
                ) : null}
              </Pressable>
            )
          })
        )}

        {/* With nothing picked, a kind that allows it can still be saved on its own — last in the
            list, since it's the fallback rather than the point of the sheet. */}
        {selectedIds.length === 0 && selectedType.allowsUnpaired ? (
          <Button label="Save without match" onPress={() => onSave({ kind: selectedType.kind, counterpartIds: [] })} />
        ) : null}
      </ScrollView>

      {/* Once something is picked, saving comes up from the bottom of the sheet, so it's in reach
          without scrolling past every candidate — the list runs on behind it. The line above the
          button is the sum the save will record: the net expense, or how a split adds up. */}
      {selectedIds.length > 0 ? (
        <Animated.View
          entering={FadeInDown.duration(220)}
          exiting={FadeOutDown.duration(160)}
          className="gap-3 border-t px-5 pt-4"
          style={{ borderColor: colors.border, backgroundColor: colors.surface, paddingBottom: insets.bottom + 12 }}
        >
          {split ? (
            <SplitSummary allocated={split.allocated} available={incomeAvailable} left={split.left} over={split.over} accent={accent} />
          ) : reimbursement ? (
            <View className="gap-1">
              <Text className="font-sans text-base text-textPrimary">
                Net expense: {formatAmount(reimbursement.expense)} − {formatAmount(reimbursement.income)} ={' '}
                <Text className="font-mono text-expense">
                  {formatAmount(Math.max(0, reimbursement.expense - reimbursement.income))}
                </Text>
              </Text>
              {/* More came back than the expense cost. Only what covers it is netted; the rest is
                  income, and saying so here is what keeps the $0 above from reading as all of it.
                  From the income side, it's also the moment a split is likely what the user wants:
                  the rest of this money paid for something else. */}
              {reimbursement.income > reimbursement.expense ? (
                <View className="flex-row flex-wrap items-center justify-between gap-x-3 gap-y-1">
                  <Text className="shrink font-sans text-sm text-textPrimary">
                    The other{' '}
                    <Text className="font-mono text-income">{formatAmount(reimbursement.income - reimbursement.expense)}</Text>{' '}
                    still counts as income.
                  </Text>
                  {canSplit ? (
                    <Pressable onPress={() => setSplitting(true)} hitSlop={8} accessibilityRole="button">
                      <Text className="font-sansSemi text-sm" style={{ color: accent }}>Split the rest</Text>
                    </Pressable>
                  ) : null}
                </View>
              ) : null}
            </View>
          ) : null}
          <Button
            label={
              isReimbursement
                ? split && selectedIds.length > 1
                  ? `Save ${selectedIds.length} Reimbursements`
                  : 'Save Reimbursement'
                : 'Save Transfer'
            }
            onPress={handleSave}
            disabled={!canSave}
          />
        </Animated.View>
      ) : null}
    </>
  )
}

/**
 * How a split adds up: a bar filling toward the whole income, the running total, and what that
 * leaves — still income, or too much to save.
 */
function SplitSummary({ allocated, available, left, over, accent }: { allocated: number; available: number; left: number; over: number; accent: string }) {
  const fill = available > 0 ? Math.min(1, allocated / available) : 0
  const barColor = over > 0 ? colors.expense : accent
  return (
    <View className="gap-2">
      <View className="flex-row items-baseline justify-between gap-3">
        <Text className="font-sansMed text-base text-textPrimary">Allocated</Text>
        <Text className="font-mono text-base text-textPrimary">
          {formatAmount(allocated)} <Text className="font-sans text-sm text-textPrimary">of {formatAmount(available)}</Text>
        </Text>
      </View>
      <View className="h-2 overflow-hidden rounded-full" style={{ backgroundColor: colors.border }}>
        <View className="h-full rounded-full" style={{ width: `${fill * 100}%`, backgroundColor: barColor }} />
      </View>
      {over > 0 ? (
        <Text className="font-sansMed text-sm" style={{ color: colors.expense }}>
          {formatAmount(over)} more than came in — lower a share to save.
        </Text>
      ) : left > 0 ? (
        <Text className="font-sans text-sm text-textPrimary">
          The other <Text className="font-mono text-income">{formatAmount(left)}</Text> still counts as income.
        </Text>
      ) : null}
    </View>
  )
}
