import { useEffect, useState } from 'react'
import { Pressable, ScrollView, Switch, Text, View } from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import type { SheetScroll } from '@/components/ui/BottomSheet'
import { CategoryIcon } from '@/components/categories/CategoryIcon'
import { CategoryPicker } from '@/components/categories/CategoryPicker'
import { LinkedTransactions } from '@/components/transactions/LinkedTransactions'
import { Button } from '@/components/ui/Button'
import { TextField } from '@/components/ui/TextField'
import { formatAmount } from '@/lib/format/money'
import { formatFullDate } from '@/lib/format/date'
import { amountSign, transactionAmountColor } from '@/lib/transactions/amountDisplay'
import { linkPillLabel } from '@/lib/transactions/linkSummary'
import { useAccountMarks } from '@/hooks/useAccountMarks'
import { AccountMarkChip } from '@/components/accounts/AccountMarkChip'
import { colors, hexToRgba } from '@/constants/theme'
import { TRANSFER_TYPES } from '@/lib/transfers/registry'
import type { FeedItem, FeedLink } from '@/lib/transactions/resolveFeed'
import type { Category, Subcategory, TransferKind } from '@/types/domain'
import { SheetHeader } from '@/components/ui/SheetHeader'

interface TransactionDetailSheetProps {
  /** Owned by the single sheet host, so drag-to-dismiss tracks whichever content is showing. */
  sheetScroll: SheetScroll
  item: FeedItem | null
  categories: Category[]
  subcategories: Subcategory[]
  pendingTransfer: { kind: TransferKind; counterpartItems: FeedItem[] } | null
  /** Covers the save's whole run of writes, not one mutation — see isSavingDetail on the editor. */
  isSaving: boolean
  onClose: () => void
  onSave: (input: { categoryId: string | null; subcategoryId: string | null; applyToVendor: boolean; note: string | null }) => void
  onOpenTransfer: (forcedKind?: TransferKind) => void
  onClearPendingTransfer: () => void
  onUnmarkTransfer: () => void
  onUnlink: (link: FeedLink) => Promise<void>
}

export function TransactionDetailSheet({ sheetScroll, item, categories, subcategories, pendingTransfer, isSaving, onClose, onSave, onOpenTransfer, onClearPendingTransfer, onUnmarkTransfer, onUnlink }: TransactionDetailSheetProps) {
  const [categoryId, setCategoryId] = useState<string | null>(item?.categoryId ?? null)
  const [subcategoryId, setSubcategoryId] = useState<string | null>(item?.subcategoryId ?? null)
  const [applyToVendor, setApplyToVendor] = useState(true)
  const [note, setNote] = useState(item?.note ?? '')
  const [markReimbursed, setMarkReimbursed] = useState(false)
  const [markTransfer, setMarkTransfer] = useState(false)
  const [pickerOpen, setPickerOpen] = useState(false)
  const accountMarks = useAccountMarks()

  useEffect(() => {
    setCategoryId(item?.categoryId ?? null)
    setSubcategoryId(item?.subcategoryId ?? null)
    setApplyToVendor(true)
    setNote(item?.note ?? '')
    // Both legs count as "already reimbursed": reimbursedAmount marks the expense side,
    // isReimbursementIncome the income side. Seeding from the expense field alone left the
    // toggle OFF on an already-linked income — flipping it on offered the expense list again,
    // and saving created a second transfer row for an income the DB allows exactly one of
    // (transfers_income_plaid_unique), surfacing as a raw duplicate-key error.
    setMarkReimbursed(item?.reimbursedAmount != null || item?.isReimbursementIncome === true)
    setMarkTransfer(item?.transferKind != null)
    setPickerOpen(false)
  }, [item?.id])

  if (!item) return null

  const accountMark = item.accountId ? accountMarks.get(item.accountId) ?? null : null
  const amountColor = transactionAmountColor(item)
  const pillLabel = linkPillLabel(item)
  const selectedCategory = categories.find((c) => c.id === categoryId) ?? null
  const availableSubcategories = subcategories.filter((s) => s.categoryId === categoryId)
  const wasTransfer = item.transferKind != null
  const wasReimbursed = item.reimbursedAmount != null || item.isReimbursementIncome
  const isReimbursementPending = pendingTransfer?.kind === 'reimbursement'
  const isTransferPending = pendingTransfer != null && pendingTransfer.kind !== 'reimbursement'
  const effectiveMarkReimbursed = markReimbursed || isReimbursementPending
  const effectiveMarkTransfer = markTransfer || isTransferPending

  function handleSave() {
    if (!effectiveMarkTransfer && wasTransfer) {
      onUnmarkTransfer()
    } else if (effectiveMarkTransfer && !wasTransfer && !isTransferPending) {
      onOpenTransfer()
    } else if (!effectiveMarkReimbursed && wasReimbursed) {
      onUnmarkTransfer()
    } else if (effectiveMarkReimbursed && !wasReimbursed && !isReimbursementPending) {
      onOpenTransfer('reimbursement')
    } else {
      onSave({ categoryId, subcategoryId, applyToVendor, note: note.trim().length > 0 ? note.trim() : null })
    }
  }

  const transferType = pendingTransfer ? TRANSFER_TYPES[pendingTransfer.kind] : null

  return (
    <>
      <SheetHeader title={item.merchantName} onClose={onClose} />

      <ScrollView {...sheetScroll.scrollProps} className="px-5" contentContainerClassName="gap-4 pb-10">
        {/* The transaction itself, centred: which card it hit, what it came to, when. */}
        <View className="items-center gap-3 pt-1">
          <AccountMarkChip mark={accountMark} ringColor={amountColor} size={56} />

          <Text className="font-display text-2xl" style={{ color: amountColor }}>
            {amountSign(item)}{formatAmount(Math.abs(item.amount))}
          </Text>
          <Text className="font-sansMed text-sm text-textSecondary">{formatFullDate(item.date)}</Text>

          {item.pending ? (
            <View className="rounded-full px-2.5 py-1" style={{ backgroundColor: hexToRgba(colors.textMuted, 0.14) }}>
              <Text className="font-sansMed text-xs" style={{ color: colors.textMuted }}>
                Pending — not yet reflected in the account balance
              </Text>
            </View>
          ) : null}

          {pillLabel ? (
            <View className="rounded-full px-2.5 py-1" style={{ backgroundColor: hexToRgba(colors.reimbursed, 0.14) }}>
              <Text className="font-sansMed text-xs" style={{ color: colors.reimbursed }}>{pillLabel}</Text>
            </View>
          ) : null}
        </View>

        {/* The category is settled far more often than it's changed, so the sheet shows what it
            currently is and keeps the picker — a wide scrolling strip of tiles — behind a tap. */}
        <View className="gap-2">
          <Text className="font-sansMed text-sm text-textSecondary">Category</Text>
          <Pressable
            onPress={() => setPickerOpen((open) => !open)}
            accessibilityRole="button"
            accessibilityState={{ expanded: pickerOpen }}
            className="flex-row items-center justify-between rounded-md border border-border px-3 py-3"
          >
            <View className="flex-row items-center gap-2">
              <View
                className="h-8 w-8 items-center justify-center rounded-full"
                style={{ backgroundColor: hexToRgba(selectedCategory?.color ?? colors.textMuted, 0.18) }}
              >
                <CategoryIcon icon={selectedCategory?.icon ?? null} size={16} color={selectedCategory?.color} />
              </View>
              <Text className="font-sansMed text-base text-textPrimary">
                {selectedCategory?.name ?? 'Uncategorized'}
              </Text>
            </View>
            <Ionicons name={pickerOpen ? 'chevron-up' : 'chevron-down'} size={18} color={colors.textMuted} />
          </Pressable>

          {pickerOpen ? (
            <CategoryPicker
              categories={categories}
              selectedCategoryId={categoryId}
              onSelect={(id) => {
                setCategoryId(id)
                setSubcategoryId(null)
                // Collapse on choice: the answer is now on the row above, and leaving the strip
                // open pushes everything below it off screen.
                setPickerOpen(false)
              }}
            />
          ) : null}
        </View>

        {availableSubcategories.length > 0 ? (
          <View className="flex-row flex-wrap gap-2">
            {availableSubcategories.map((sub) => (
              <Text
                key={sub.id}
                onPress={() => setSubcategoryId(sub.id)}
                className={`rounded-full border px-3 py-2 font-sansMed text-sm ${
                  subcategoryId === sub.id ? 'border-primary bg-primaryMuted text-primary' : 'border-border text-textSecondary'
                }`}
              >
                {sub.name}
              </Text>
            ))}
          </View>
        ) : null}

        {/* The placeholder is the name the row currently shows — what a saved note replaces. */}
        <TextField
          label="Note (optional)"
          value={note}
          onChangeText={setNote}
          placeholder={item.merchantName}
        />

        <View className="flex-row items-center justify-between py-3">
          <Text className="flex-1 pr-3 font-sans text-base text-textPrimary" numberOfLines={2}>
            Apply to all future {item.merchantName}?
          </Text>
          <Switch value={applyToVendor} onValueChange={setApplyToVendor} />
        </View>

        {/* Both sides can start a reimbursement: an income is "this money paid me back", an
            expense is "this cost got paid back" — the expense side is also where several
            incomes can be linked against one cost in a single pass. */}
        <View className="flex-row items-center justify-between py-3">
          <Text className="flex-1 pr-3 font-sans text-base text-textPrimary">
            {item.amount > 0 ? 'Mark as Reimbursed' : 'Mark as Reimbursement'}
          </Text>
            <Switch
              value={effectiveMarkReimbursed}
              onValueChange={(next) => {
                setMarkReimbursed(next)
                if (next) {
                  setMarkTransfer(false)
                  if (isTransferPending) onClearPendingTransfer()
                  if (!isReimbursementPending) onOpenTransfer('reimbursement')
                } else {
                  if (isReimbursementPending) onClearPendingTransfer()
                }
              }}
            />
          </View>

        {isReimbursementPending && transferType ? (
          <View className="rounded-lg border px-3 py-3" style={{ borderColor: transferType.color, backgroundColor: hexToRgba(transferType.color, 0.08) }}>
            <View className="flex-row items-center gap-2">
              <Ionicons name={transferType.icon} size={14} color={transferType.color} />
              <Text className="font-sansMed text-sm" style={{ color: transferType.color }}>{transferType.label}</Text>
            </View>
            {pendingTransfer.counterpartItems.length > 0 ? (
              pendingTransfer.counterpartItems.map((linked) => (
                <Text key={linked.id} className="mt-1 font-sans text-sm text-textSecondary" numberOfLines={1}>
                  {linked.merchantName} · {formatAmount(Math.abs(linked.amount))}
                </Text>
              ))
            ) : null}
          </View>
        ) : null}

        <View className="flex-row items-center justify-between py-3">
          <Text className="flex-1 pr-3 font-sans text-base text-textPrimary">Mark as Transfer</Text>
          <Switch
            value={effectiveMarkTransfer}
            onValueChange={(next) => {
              setMarkTransfer(next)
              if (next) {
                setMarkReimbursed(false)
                if (isReimbursementPending) onClearPendingTransfer()
                if (!isTransferPending) onOpenTransfer()
              } else {
                if (isTransferPending) onClearPendingTransfer()
              }
            }}
          />
        </View>

        {isTransferPending && transferType ? (
          <View className="rounded-lg border px-3 py-3" style={{ borderColor: transferType.color, backgroundColor: hexToRgba(transferType.color, 0.08) }}>
            <View className="flex-row items-center gap-2">
              <Ionicons name={transferType.icon} size={14} color={transferType.color} />
              <Text className="font-sansMed text-sm" style={{ color: transferType.color }}>{transferType.label}</Text>
            </View>
            {pendingTransfer.counterpartItems.length > 0 ? (
              pendingTransfer.counterpartItems.map((linked) => (
                <Text key={linked.id} className="mt-1 font-sans text-sm text-textSecondary" numberOfLines={1}>
                  Linked to {linked.merchantName} · {formatAmount(Math.abs(linked.amount))}
                </Text>
              ))
            ) : (
              <Text className="mt-1 font-sans text-sm text-textMuted">No match selected</Text>
            )}
          </View>
        ) : null}

        <LinkedTransactions item={item} onUnlink={onUnlink} />

        <Button label="Save Changes" onPress={handleSave} loading={isSaving} />
      </ScrollView>
    </>
  )
}
