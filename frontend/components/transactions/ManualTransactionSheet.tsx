import { useEffect, useRef, useState } from 'react'
import { Keyboard, Platform, Pressable, ScrollView, Switch, Text, TextInput, View } from 'react-native'
import DateTimePicker from '@react-native-community/datetimepicker'
import { Ionicons } from '@expo/vector-icons'
import type { SheetScroll } from '@/components/ui/BottomSheet'
import { SegmentedControl } from '@/components/ui/SegmentedControl'
import { CategoryPicker } from '@/components/categories/CategoryPicker'
import { TextField } from '@/components/ui/TextField'
import { Button } from '@/components/ui/Button'
import { colors, hexToRgba } from '@/constants/theme'
import { formatAmount } from '@/lib/format/money'
import { TRANSFER_TYPES } from '@/lib/transfers/registry'
import type { FeedItem } from '@/lib/transactions/resolveFeed'
import type { Category, ManualTransaction, Subcategory, TransferKind } from '@/types/domain'
// DateTimePicker works in the device's LOCAL timezone, which is the basis these helpers keep —
// see dateKey.ts for what goes wrong with the UTC conversions that look equivalent.
import { fromDateKey, toDateKey } from '@/lib/dates/dateKey'

interface ManualTransactionSheetProps {
  /** Still meaningful after the single-host change: this sheet stays MOUNTED while hidden (the
   *  returningFromTransfer ref below depends on it), so `visible` is what tells it it was reopened. */
  visible: boolean
  /** Owned by the single sheet host, so drag-to-dismiss tracks whichever content is showing. */
  sheetScroll: SheetScroll
  transaction?: ManualTransaction
  categories: Category[]
  subcategories: Subcategory[]
  isSaving: boolean
  onClose: () => void
  onSave: (input: ManualTransactionInput) => void
  onDelete?: () => void
  /** True when this transaction is already the expense leg of a transfer. */
  isTransfer?: boolean
  /** True when this transaction is already part of a reimbursement (either leg). */
  isReimbursed?: boolean
  /** The counterpart picked in the transfer sheet, waiting to be written on save. */
  pendingTransfer?: { kind: TransferKind; counterpartItems: FeedItem[] } | null
  /** Opens the transfer sheet immediately with the current (unsaved) form values. */
  onOpenTransfer?: (input: ManualTransactionInput, forcedKind?: TransferKind) => void
  onClearPendingTransfer?: () => void
  /** Persists the edit and deletes the transfer link. */
  onSaveAndUnmarkTransfer?: (input: ManualTransactionInput) => void
}

export interface ManualTransactionInput {
  amount: string
  type: 'expense' | 'income'
  categoryId: string | null
  subcategoryId: string | null
  date: string
  note: string | null
}

export function ManualTransactionSheet({
  visible,
  sheetScroll,
  transaction,
  categories,
  subcategories,
  isSaving,
  onClose,
  onSave,
  onDelete,
  isTransfer = false,
  isReimbursed = false,
  pendingTransfer = null,
  onOpenTransfer,
  onClearPendingTransfer,
  onSaveAndUnmarkTransfer,
}: ManualTransactionSheetProps) {
  const [type, setType] = useState<'expense' | 'income'>(transaction?.type ?? 'expense')
  const [amountText, setAmountText] = useState(transaction?.amount ?? '')
  const [categoryId, setCategoryId] = useState<string | null>(transaction?.categoryId ?? null)
  const [subcategoryId, setSubcategoryId] = useState<string | null>(transaction?.subcategoryId ?? null)
  const [date, setDate] = useState(transaction?.date ?? toDateKey(new Date()))
  const [note, setNote] = useState(transaction?.note ?? '')
  const [showAndroidPicker, setShowAndroidPicker] = useState(false)
  const [markTransfer, setMarkTransfer] = useState(isTransfer)
  const [markReimbursed, setMarkReimbursed] = useState(isReimbursed)
  const [isNoteFocused, setIsNoteFocused] = useState(false)
  const scrollRef = useRef<ScrollView>(null)
  // Set when this sheet closes to hand off to the transfer sheet: the reopen that follows
  // confirm/decline must keep the user's mid-edit values instead of re-seeding the form.
  const returningFromTransfer = useRef(false)

  useEffect(() => {
    if (!isNoteFocused) return
    const subscription = Keyboard.addListener('keyboardDidShow', () => scrollRef.current?.scrollToEnd({ animated: true }))
    return () => subscription.remove()
  }, [isNoteFocused])

  function handleNoteFocus() {
    setIsNoteFocused(true)
    scrollRef.current?.scrollToEnd({ animated: true })
  }

  // The parent screen keeps one persistent instance of this sheet and only toggles `visible`,
  // so local state must be re-derived whenever it's reopened — for a different transaction,
  // for the edit -> create transition (transaction?.id goes to undefined), and for a second
  // create in a row, where the id never changes and only the `visible` flip says "new form".
  // Gated on visible so closing doesn't blank the fields mid exit-animation.
  useEffect(() => {
    if (!visible) return
    if (returningFromTransfer.current) {
      returningFromTransfer.current = false
      return
    }
    setType(transaction?.type ?? 'expense')
    setAmountText(transaction?.amount ?? '')
    setCategoryId(transaction?.categoryId ?? null)
    setSubcategoryId(transaction?.subcategoryId ?? null)
    setDate(transaction?.date ?? toDateKey(new Date()))
    setNote(transaction?.note ?? '')
    setMarkTransfer(isTransfer)
    setMarkReimbursed(isReimbursed)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [transaction?.id, visible])

  const availableSubcategories = subcategories.filter((s) => s.categoryId === categoryId)
  const isValidAmount = /^\d+(\.\d{1,2})?$/.test(amountText) && Number(amountText) > 0

  const canMark = transaction != null && onOpenTransfer != null
  const isReimbursementPending = pendingTransfer?.kind === 'reimbursement'
  const isTransferPending = pendingTransfer != null && pendingTransfer.kind !== 'reimbursement'
  const effectiveMarkReimbursed = markReimbursed || isReimbursementPending
  const effectiveMarkTransfer = markTransfer || isTransferPending
  const pendingType = pendingTransfer ? TRANSFER_TYPES[pendingTransfer.kind] : null

  function currentInput(): ManualTransactionInput {
    return {
      amount: amountText,
      type,
      categoryId,
      subcategoryId,
      date,
      note: note.trim().length > 0 ? note.trim() : null,
    }
  }

  // Mirrors the Plaid detail sheet: flipping a mark toggle opens the linking sheet right away.
  // Gated on a valid amount — the counterpart suggestions are scored against it.
  function openLinking(forcedKind?: TransferKind) {
    if (!isValidAmount || !onOpenTransfer) return
    returningFromTransfer.current = true
    onOpenTransfer(currentInput(), forcedKind)
  }

  function handleSave() {
    const input = currentInput()

    if (isReimbursed && !effectiveMarkReimbursed && onSaveAndUnmarkTransfer) {
      // Unmarking a reimbursement and unmarking a transfer are the same operation: drop the
      // item's links.
      onSaveAndUnmarkTransfer(input)
    } else if (isTransfer && !effectiveMarkTransfer && onSaveAndUnmarkTransfer) {
      onSaveAndUnmarkTransfer(input)
    } else if (canMark && effectiveMarkReimbursed && !isReimbursed && !isReimbursementPending) {
      // Toggle is on but nothing was linked (the sheet was declined) — re-prompt rather than
      // silently saving an unmarked transaction, same as the detail sheet.
      openLinking('reimbursement')
    } else if (canMark && effectiveMarkTransfer && !isTransfer && !isTransferPending) {
      openLinking()
    } else {
      // Writes the edit, and the pending link with it if one was picked.
      onSave(input)
    }
  }

  return (
    <>
      <View className="flex-row items-center justify-between px-5 py-3">
        <Pressable onPress={onClose} hitSlop={8}>
          <Ionicons name="close" size={22} color={colors.textSecondary} />
        </Pressable>
        <Text className="font-display text-md text-textPrimary">
          {transaction ? 'Edit Transaction' : 'Add Transaction'}
        </Text>
        <View style={{ width: 22 }} />
      </View>

      <ScrollView {...sheetScroll.scrollProps} ref={scrollRef} className="px-5" contentContainerClassName="gap-4 pb-10" keyboardShouldPersistTaps="handled">

        <SegmentedControl
          options={[{ label: 'Expense', value: 'expense' as const }, { label: 'Income', value: 'income' as const }]}
          value={type}
          onChange={setType}
        />

        <View className="my-4 items-center">
          <Text className="font-sansMed text-sm text-textSecondary">Amount</Text>
          <TextInput
            value={amountText}
            onChangeText={setAmountText}
            keyboardType="decimal-pad"
            placeholder="0.00"
            placeholderTextColor={colors.textMuted}
            className={`font-display text-3xl ${type === 'expense' ? 'text-expense' : 'text-income'}`}
          />
        </View>

        <Text className="mb-2 font-sansMed text-sm text-textSecondary">Category</Text>
        <CategoryPicker
          categories={categories}
          selectedCategoryId={categoryId}
          onSelect={(id) => {
            setCategoryId(id)
            setSubcategoryId(null)
          }}
        />

        {availableSubcategories.length > 0 ? (
          <View className="mt-3 flex-row flex-wrap gap-2">
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

        <View className="my-4">
          <Text className="mb-2 font-sansMed text-sm text-textSecondary">Date</Text>
          {Platform.OS === 'ios' ? (
            <DateTimePicker
              value={fromDateKey(date)}
              mode="date"
              display="inline"
              onChange={(_, selected) => selected && setDate(toDateKey(selected))}
            />
          ) : (
            <>
              <Pressable onPress={() => setShowAndroidPicker(true)} className="rounded-lg border border-border px-3 py-3">
                <Text className="font-sans text-base text-textPrimary">{date}</Text>
              </Pressable>
              {showAndroidPicker ? (
                <DateTimePicker
                  value={fromDateKey(date)}
                  mode="date"
                  display="default"
                  onChange={(_, selected) => {
                    setShowAndroidPicker(false)
                    if (selected) setDate(toDateKey(selected))
                  }}
                />
              ) : null}
            </>
          )}
        </View>

        <TextField
          label="Note (optional)"
          value={note}
          onChangeText={setNote}
          placeholder="e.g. Street food, cash"
          onFocus={handleNoteFocus}
          onBlur={() => setIsNoteFocused(false)}
        />

        {canMark ? (
          <View className="flex-row items-center justify-between py-3">
            <Text className="flex-1 pr-3 font-sans text-base text-textPrimary">
              {type === 'expense' ? 'Mark as Reimbursed' : 'Mark as Reimbursement'}
            </Text>
            <Switch
              value={effectiveMarkReimbursed}
              onValueChange={(next) => {
                setMarkReimbursed(next)
                if (next) {
                  setMarkTransfer(false)
                  if (isTransferPending) onClearPendingTransfer?.()
                  if (!isReimbursementPending) openLinking('reimbursement')
                } else if (isReimbursementPending) {
                  onClearPendingTransfer?.()
                }
              }}
            />
          </View>
        ) : null}

        {isReimbursementPending && pendingType ? (
          <View className="rounded-lg border px-3 py-3" style={{ borderColor: pendingType.color, backgroundColor: hexToRgba(pendingType.color, 0.08) }}>
            <View className="flex-row items-center gap-2">
              <Ionicons name={pendingType.icon} size={14} color={pendingType.color} />
              <Text className="font-sansMed text-sm" style={{ color: pendingType.color }}>{pendingType.label}</Text>
            </View>
            {pendingTransfer!.counterpartItems.map((linked) => (
              <Text key={linked.id} className="mt-1 font-sans text-sm text-textSecondary" numberOfLines={1}>
                {linked.merchantName} · {formatAmount(Math.abs(linked.amount))}
              </Text>
            ))}
          </View>
        ) : null}

        {canMark ? (
          <View className="flex-row items-center justify-between py-3">
            <Text className="flex-1 pr-3 font-sans text-base text-textPrimary">Mark as Transfer</Text>
            <Switch
              value={effectiveMarkTransfer}
              onValueChange={(next) => {
                setMarkTransfer(next)
                if (next) {
                  setMarkReimbursed(false)
                  if (isReimbursementPending) onClearPendingTransfer?.()
                  if (!isTransferPending) openLinking()
                } else if (isTransferPending) {
                  onClearPendingTransfer?.()
                }
              }}
            />
          </View>
        ) : null}

        {isTransferPending && pendingType ? (
          <View className="rounded-lg border px-3 py-3" style={{ borderColor: pendingType.color, backgroundColor: hexToRgba(pendingType.color, 0.08) }}>
            <View className="flex-row items-center gap-2">
              <Ionicons name={pendingType.icon} size={14} color={pendingType.color} />
              <Text className="font-sansMed text-sm" style={{ color: pendingType.color }}>{pendingType.label}</Text>
            </View>
            {pendingTransfer!.counterpartItems.map((linked) => (
              <Text key={linked.id} className="mt-1 font-sans text-sm text-textSecondary" numberOfLines={1}>
                {linked.merchantName} · {formatAmount(Math.abs(linked.amount))}
              </Text>
            ))}
          </View>
        ) : null}

        <View className="mt-4 gap-2">
          <Button label="Save Transaction" onPress={handleSave} disabled={!isValidAmount} loading={isSaving} />
          {onDelete ? <Button label="Delete Transaction" variant="ghost" onPress={onDelete} /> : null}
        </View>
      </ScrollView>
    </>
  )
}
