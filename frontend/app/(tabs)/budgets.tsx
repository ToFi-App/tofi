import { useMemo, useState } from 'react'
import { Pressable, ScrollView, StyleSheet, Switch, Text, View } from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import { SafeAreaView } from 'react-native-safe-area-context'
import { borderRadius, colors, shadow } from '@/constants/theme'
import { useTransactionFeed } from '@/hooks/useTransactionFeed'
import { useBudgets } from '@/hooks/useBudgets'
import { useCategories } from '@/hooks/useCategories'
import { CategoryIcon } from '@/components/categories/CategoryIcon'
import { BudgetOverview } from '@/components/budgets/BudgetOverview'
import { BudgetBadge, BudgetRingTile } from '@/components/budgets/BudgetRingTile'
import { statusColor } from '@/components/budgets/statusColor'
import { BudgetSuggestions } from '@/components/budgets/BudgetSuggestions'
import { AmountInput } from '@/components/budgets/AmountInput'
import { Eyebrow } from '@/components/budgets/Eyebrow'
import { SpendingSummary } from '@/components/budgets/SpendingSummary'
import { MonthNavigator } from '@/components/transactions/MonthNavigator'
import { BottomSheet, useSheetScroll } from '@/components/ui/BottomSheet'
import { TextField } from '@/components/ui/TextField'
import { Pill } from '@/components/ui/RangePills'
import { Button } from '@/components/ui/Button'
import { ErrorBanner } from '@/components/ui/ErrorBanner'
import { EmptyState } from '@/components/ui/EmptyState'
import { LoadingScreen } from '@/components/ui/LoadingScreen'
import { ensureNotificationPermission } from '@/lib/notifications/permission'
import { formatAmount } from '@/lib/format/money'
import { filterByMonth, shiftMonth } from '@/lib/transactions/filterByMonth'
import { useSelectedMonth } from '@/hooks/useSelectedMonth'
import { aggregateMonth } from '@/lib/transactions/aggregateMonth'
import {
  budgetStatus,
  dailyAllowance,
  monthElapsedFraction,
  monthKey,
  resolveBudgetsForMonth,
  suggestBudgetAmount,
  type BudgetStatus,
} from '@/lib/budgets/budgetMath'
import { compareWithPreviousMonth } from '@/lib/budgets/monthComparison'

const ALERT_PRESETS = [50, 75, 90, 100]
const DEFAULT_ALERT_PRESET = 90

// Budgets that need attention lead the grid, so a problem is never below the fold.
const STATUS_RANK: Record<BudgetStatus, number> = { over: 0, 'at-risk': 1, 'on-track': 2 }

// Two rows of the grid. More than that stops reading at a glance and pushes the spending summary
// a screen down; the rest wait behind "Show more", and since problems sort first, what's folded
// away is the calmest of the lot.
const GRID_PREVIEW = 6

/** Dollars → whole-percent-of-budget, the unit alerts are stored in (they scale with edits). */
function toThresholdPercent(alertDollars: number, budgetDollars: number): number {
  return Math.min(100, Math.max(1, Math.round((alertDollars / budgetDollars) * 100)))
}

function toDollarText(n: number): string {
  return String(Math.round(n * 100) / 100)
}

function formatEffectiveMonth(effectiveMonth: string): string {
  const [year, month] = effectiveMonth.split('-').map(Number)
  return new Date(year, month - 1, 1).toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
}

export default function BudgetsScreen() {
  const sheetScroll = useSheetScroll()
  const [month, setMonth] = useSelectedMonth()
  const [editingCategoryId, setEditingCategoryId] = useState<string | null>(null)
  const [amountText, setAmountText] = useState('')
  const [alertOn, setAlertOn] = useState(false)
  // A preset percentage, or null for a custom alert entered in dollars (alertAmountText).
  const [alertPreset, setAlertPreset] = useState<number | null>(DEFAULT_ALERT_PRESET)
  const [alertAmountText, setAlertAmountText] = useState('')
  const [isSaving, setIsSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [showOtherCategories, setShowOtherCategories] = useState(false)
  const [showAllBudgets, setShowAllBudgets] = useState(false)

  const { feed, isLoading, error } = useTransactionFeed()
  const budgets = useBudgets()
  const categories = useCategories()

  const monthFeed = useMemo(() => filterByMonth(feed, month), [feed, month])
  const { spendByCategory } = useMemo(() => aggregateMonth(monthFeed), [monthFeed])
  const categoryById = useMemo(() => new Map((categories.data ?? []).map((c) => [c.id, c])), [categories.data])

  // Budgets are effective-dated: the viewed month sees whatever amount was in force then, so
  // browsing back never rewrites history with today's numbers.
  const resolved = useMemo(() => resolveBudgetsForMonth(budgets.data ?? [], month), [budgets.data, month])
  const elapsed = useMemo(() => monthElapsedFraction(month), [month])
  const paceFraction = elapsed > 0 && elapsed < 1 ? elapsed : null

  const budgetedRows = useMemo(() => {
    return [...resolved.values()]
      .map((budget) => {
        const spent = spendByCategory.get(budget.categoryId) ?? 0
        return { budget, spent, status: budgetStatus(spent, budget.amount, elapsed) }
      })
      .sort(
        (a, b) => STATUS_RANK[a.status] - STATUS_RANK[b.status] || b.spent / b.budget.amount - a.spent / a.budget.amount,
      )
  }, [resolved, spendByCategory, elapsed])

  // Categories with real spending history float to the top with their typical month shown —
  // that's where a budget is actually useful. Income-ish categories naturally sink to the
  // bottom because they have no net spend (categories carry no income/expense flag to filter on).
  const unbudgetedCategories = useMemo(() => {
    return (categories.data ?? [])
      .filter((c) => !resolved.has(c.id))
      .map((category) => ({ category, typical: suggestBudgetAmount(feed, category.id, month) }))
      .sort((a, b) => (b.typical?.amount ?? 0) - (a.typical?.amount ?? 0) || a.category.name.localeCompare(b.category.name))
  }, [categories.data, resolved, feed, month])

  // Categories with a typical month are worth suggesting; the rest wait behind a disclosure.
  const suggestedCategories = unbudgetedCategories.flatMap(({ category, typical }) =>
    typical != null && typical.amount > 0 ? [{ category, typical: typical.amount }] : [],
  )
  const otherCategories = unbudgetedCategories.filter(({ typical }) => typical == null || typical.amount <= 0)

  const comparison = useMemo(() => compareWithPreviousMonth(feed, month), [feed, month])

  const totalBudget = budgetedRows.reduce((sum, row) => sum + row.budget.amount, 0)
  const totalSpent = budgetedRows.reduce((sum, row) => sum + row.spent, 0)
  const totalRemaining = totalBudget - totalSpent
  const allowance = dailyAllowance(totalRemaining, month)
  const overallStatus = budgetStatus(totalSpent, totalBudget, elapsed)
  const foldedRows = showAllBudgets ? [] : budgetedRows.slice(GRID_PREVIEW)
  const visibleRows = showAllBudgets ? budgetedRows : budgetedRows.slice(0, GRID_PREVIEW)
  // Only possible with more problems than fit in the preview, but then it must not stay silent.
  const foldedNeedingAttention = foldedRows.filter((row) => row.status !== 'on-track').length
  const daysLeft = paceFraction != null ? new Date(month.year, month.month, 0).getDate() - new Date().getDate() + 1 : null

  const editingBudget = editingCategoryId ? (resolved.get(editingCategoryId) ?? null) : null
  const editingCategory = editingCategoryId ? categoryById.get(editingCategoryId) : null
  const editingSpent = editingCategoryId ? (spendByCategory.get(editingCategoryId) ?? 0) : 0
  const editingStatus = editingBudget ? budgetStatus(editingSpent, editingBudget.amount, elapsed) : 'on-track'
  const editingLeft = editingBudget ? editingBudget.amount - editingSpent : 0
  const editingTone = editingStatus === 'on-track' ? colors.textPrimary : statusColor(editingStatus)
  const suggestion = useMemo(
    () => (editingCategoryId && !editingBudget ? suggestBudgetAmount(feed, editingCategoryId, month) : null),
    [feed, editingCategoryId, editingBudget, month],
  )

  const isValidAmount = /^\d+(\.\d{1,2})?$/.test(amountText) && Number(amountText) > 0
  const budgetAmount = isValidAmount ? Number(amountText) : null
  const customAlertDollars =
    budgetAmount != null &&
    /^\d+(\.\d{1,2})?$/.test(alertAmountText) &&
    Number(alertAmountText) > 0 &&
    Number(alertAmountText) <= budgetAmount
      ? Number(alertAmountText)
      : null
  // A preset stays a percentage when the budget is edited — 75% of whatever the budget becomes —
  // rather than a dollar figure that silently drifts to 68% of it. Only custom is in dollars.
  const alertPercent =
    alertPreset ?? (customAlertDollars != null && budgetAmount != null ? toThresholdPercent(customAlertDollars, budgetAmount) : null)
  const alertDollars = budgetAmount == null ? null : alertPreset != null ? budgetAmount * (alertPreset / 100) : customAlertDollars
  const daysInViewedMonth = new Date(month.year, month.month, 0).getDate()

  function openSheet(categoryId: string) {
    const existing = resolved.get(categoryId)
    const threshold = existing?.alertThreshold ?? null
    setAmountText(existing ? String(existing.amount) : '')
    setAlertOn(threshold != null)
    // A saved threshold off the presets reopens as the custom amount it was set as.
    const isCustom = threshold != null && !ALERT_PRESETS.includes(threshold)
    setAlertPreset(isCustom ? null : (threshold ?? DEFAULT_ALERT_PRESET))
    setAlertAmountText(isCustom && existing ? toDollarText((threshold / 100) * existing.amount) : '')
    setSaveError(null)
    setEditingCategoryId(categoryId)
  }

  function chooseCustomAlert() {
    // Start from the line the preset drew, so switching to custom is a nudge rather than a blank.
    if (alertAmountText === '' && alertDollars != null) setAlertAmountText(toDollarText(alertDollars))
    setAlertPreset(null)
  }

  async function save(amount: string | null) {
    if (!editingCategoryId) return
    setIsSaving(true)
    const armsAlert = amount !== null && alertOn && alertPercent != null
    try {
      await budgets.set({
        categoryId: editingCategoryId,
        effectiveMonth: monthKey(month),
        amount,
        alertThreshold: armsAlert ? alertPercent : null,
      })
      setEditingCategoryId(null)
      // Ask here rather than waiting for the first crossing: the user just armed an alert, so the
      // prompt is the answer to something they asked for, and it arms the background half now
      // instead of leaving it mute until an app-open pass happens to catch a crossing. Not
      // awaited — the sheet has already closed and the save must not hang on a dialog.
      if (armsAlert) void ensureNotificationPermission({ canPrompt: true })
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'Could not save this budget. Try again.')
    } finally {
      setIsSaving(false)
    }
  }

  const hasNoCategories = !categories.isLoading && (categories.data?.length ?? 0) === 0

  // Every hook above must run before these early returns (rules of hooks).
  if (isLoading || budgets.isLoading) return <LoadingScreen />

  if (hasNoCategories) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }} edges={['top']}>
        <EmptyState message="No categories yet — add one in Settings → Categories to start budgeting." />
      </SafeAreaView>
    )
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }} edges={['top']}>
      <ScrollView contentInsetAdjustmentBehavior="automatic" contentContainerClassName="gap-8 px-5 pb-6 pt-3">
        <View className="items-center">
          <MonthNavigator month={month} onPrevious={() => setMonth(shiftMonth(month, -1))} onNext={() => setMonth(shiftMonth(month, 1))} onSelect={setMonth} />
        </View>

        {error ? <ErrorBanner message="Something went wrong loading your budgets." /> : null}

        {budgetedRows.length > 0 ? (
          <>
            <BudgetOverview
              totalBudget={totalBudget}
              totalSpent={totalSpent}
              status={overallStatus}
              elapsed={elapsed}
              daysLeft={daysLeft}
              dailyAllowance={allowance}
            />

            <View className="gap-3">
              <Eyebrow>Your budgets</Eyebrow>
              <View className="flex-row flex-wrap" style={{ rowGap: 12 }}>
                {visibleRows.map(({ budget, spent, status }) => {
                  const category = categoryById.get(budget.categoryId)
                  return (
                    <View key={budget.budgetId} style={{ width: '33.333%' }}>
                      <BudgetRingTile
                        name={category?.name ?? 'Unknown'}
                        icon={category?.icon ?? null}
                        color={category?.color}
                        spent={spent}
                        amount={budget.amount}
                        status={status}
                        onPress={() => openSheet(budget.categoryId)}
                      />
                    </View>
                  )
                })}
              </View>
              {budgetedRows.length > GRID_PREVIEW ? (
                <Pressable
                  onPress={() => setShowAllBudgets((v) => !v)}
                  accessibilityRole="button"
                  accessibilityState={{ expanded: showAllBudgets }}
                  className="flex-row items-center justify-center gap-1.5 py-1"
                >
                  <Text className="font-sansMed text-sm text-primary">
                    {showAllBudgets ? 'Show less' : `Show ${foldedRows.length} more`}
                  </Text>
                  {foldedNeedingAttention > 0 ? (
                    <Text className="font-sansMed text-sm text-warning">· {foldedNeedingAttention} need attention</Text>
                  ) : null}
                  <Ionicons name={showAllBudgets ? 'chevron-up' : 'chevron-down'} size={14} color={colors.primary} />
                </Pressable>
              ) : null}
            </View>
          </>
        ) : (
          <View className="items-center gap-2 px-4 py-6">
            <Eyebrow>No budgets yet</Eyebrow>
            <Text className="text-center font-sans text-base text-textSecondary">
              Set a monthly limit on a category to see what&apos;s left to spend.
            </Text>
          </View>
        )}

        {/* Nothing to compare in a month that hasn't started. */}
        {elapsed > 0 ? <SpendingSummary month={month} comparison={comparison} isCurrentMonth={paceFraction != null} /> : null}

        {suggestedCategories.length > 0 ? <BudgetSuggestions items={suggestedCategories} onSelect={openSheet} /> : null}

        {otherCategories.length > 0 ? (
          <OtherCategories
            items={otherCategories.map(({ category }) => category)}
            // With no budgets and nothing to suggest, this list is the only way in, so it opens.
            isOpen={showOtherCategories || (budgetedRows.length === 0 && suggestedCategories.length === 0)}
            onToggle={() => setShowOtherCategories((v) => !v)}
            onSelect={openSheet}
          />
        ) : null}
      </ScrollView>

      <BottomSheet visible={editingCategoryId != null} onClose={() => setEditingCategoryId(null)} contentScroll={sheetScroll}>
        {/* Scrollable so the save button stays reachable when the keyboard shrinks the sheet. */}
        <ScrollView {...sheetScroll.scrollProps} className="px-5" contentContainerClassName="pb-8" keyboardShouldPersistTaps="handled">
          {/* The badge the user tapped, so the sheet reads as that budget opened up, with how this
              month is going beside it. */}
          <View className="mb-5 flex-row items-center gap-3">
            {editingCategory ? (
              <BudgetBadge
                icon={editingCategory.icon}
                color={editingCategory.color}
                spent={editingSpent}
                amount={editingBudget?.amount ?? null}
                status={editingStatus}
                size={52}
              />
            ) : null}
            <View className="flex-1">
              <Text className="font-sansSemi text-base text-textPrimary" numberOfLines={1}>
                {editingCategory?.name ?? 'Set budget'}
              </Text>
              {editingBudget ? (
                <Text className="font-sans text-xs text-textMuted">
                  Budgeting since {formatEffectiveMonth(editingBudget.effectiveMonth)}
                </Text>
              ) : null}
            </View>
            {editingBudget ? (
              <View className="items-end">
                <Text className="font-mono text-base" style={{ color: editingTone }}>
                  {formatAmount(Math.abs(editingLeft))}
                </Text>
                <Text className="font-sans text-xs" style={{ color: editingStatus === 'on-track' ? colors.textMuted : editingTone }}>
                  {editingLeft < 0 ? 'over' : 'left'} this month
                </Text>
              </View>
            ) : null}
          </View>

          {saveError ? (
            <View className="mb-4">
              <ErrorBanner message={saveError} onDismiss={() => setSaveError(null)} />
            </View>
          ) : null}

          {/* The amount as the headline it becomes, and what it means per day. */}
          <View className="items-center gap-3">
            <Eyebrow>Monthly budget</Eyebrow>
            <AmountInput
              value={amountText}
              onChangeText={setAmountText}
              placeholder={suggestion != null ? String(suggestion.amount) : '0'}
              accessibilityLabel="Monthly budget"
            />
            {budgetAmount != null ? (
              <Text className="font-sans text-sm text-textMuted">
                About <Text className="font-mono text-textSecondary">{formatAmount(budgetAmount / daysInViewedMonth)}</Text> a day
              </Text>
            ) : null}
            {suggestion != null && !editingBudget && amountText !== String(suggestion.amount) ? (
              <Pressable
                onPress={() => setAmountText(String(suggestion.amount))}
                accessibilityRole="button"
                className="rounded-full px-3.5 py-2"
                style={{ backgroundColor: colors.primaryMuted }}
              >
                <Text className="font-sansMed text-sm text-primary">
                  Use ${suggestion.amount.toLocaleString('en-US')} ·{' '}
                  {suggestion.months === 1 ? 'what you spent last month' : `your ${suggestion.months}-month average`}
                </Text>
              </Pressable>
            ) : null}
          </View>

          <View className="my-6 h-px bg-border" />

          <View className="gap-4">
            <View className="flex-row items-center justify-between">
              <View className="flex-1 pr-3">
                <Text className="font-sansMed text-base text-textPrimary">Notify me</Text>
                <Text className="font-sans text-xs text-textMuted">Get an alert when spending reaches your line.</Text>
              </View>
              <Switch value={alertOn} onValueChange={setAlertOn} />
            </View>

            {alertOn ? (
              <View className="gap-3">
                {/* Presets are fractions of the budget, so they wait for one to exist. */}
                <View
                  className="flex-row justify-between"
                  style={{ opacity: budgetAmount == null ? 0.4 : 1 }}
                  pointerEvents={budgetAmount == null ? 'none' : 'auto'}
                >
                  {ALERT_PRESETS.map((pct) => (
                    <Pill
                      key={pct}
                      label={`${pct}%`}
                      accessibilityLabel={`Alert at ${pct}% of the budget`}
                      isSelected={alertPreset === pct}
                      onPress={() => setAlertPreset(pct)}
                    />
                  ))}
                  <Pill label="Custom" accessibilityLabel="Custom alert amount" isSelected={alertPreset == null} onPress={chooseCustomAlert} />
                </View>
                {alertPreset == null ? (
                  <TextField
                    label="Alert me at"
                    value={alertAmountText}
                    onChangeText={setAlertAmountText}
                    keyboardType="decimal-pad"
                    placeholder={budgetAmount != null ? toDollarText(budgetAmount * 0.9) : '450.00'}
                    mono
                  />
                ) : null}
                {/* One line that says the result in dollars, whichever way it was chosen — amber when
                    a custom amount can't be used, since that is what's holding the button back. */}
                <Text
                  className="font-sans text-sm"
                  style={{ color: budgetAmount != null && alertDollars == null ? colors.warning : colors.textSecondary }}
                >
                  {budgetAmount == null ? (
                    "Set a monthly amount to choose when you're alerted."
                  ) : alertDollars != null && alertPercent != null ? (
                    <>
                      You&apos;ll get an alert at <Text className="font-mono text-textPrimary">{formatAmount(alertDollars)}</Text>,{' '}
                      {alertPercent}% of your budget.
                    </>
                  ) : (
                    `Enter an amount up to ${formatAmount(budgetAmount)}.`
                  )}
                </Text>
              </View>
            ) : null}
          </View>

          <View className="mt-6 gap-3">
            <Button
              label={editingBudget ? 'Save changes' : 'Set budget'}
              onPress={() => save(amountText)}
              disabled={!isValidAmount || (alertOn && alertPercent == null) || isSaving}
            />
            {editingBudget ? (
              <Text
                onPress={() => save(null)}
                disabled={isSaving}
                className="self-center px-2 py-1 text-center font-sansMed text-sm text-expense"
              >
                Stop budgeting
              </Text>
            ) : null}
          </View>
        </ScrollView>
      </BottomSheet>
    </SafeAreaView>
  )
}

interface OtherCategoriesProps {
  items: Array<{ id: string; name: string; icon: string | null; color: string }>
  isOpen: boolean
  onToggle: () => void
  onSelect: (categoryId: string) => void
}

/** Categories with no spending to go on, folded away behind one row until asked for. */
function OtherCategories({ items, isOpen, onToggle, onSelect }: OtherCategoriesProps) {
  return (
    <View className="gap-3">
      <Pressable
        onPress={onToggle}
        accessibilityRole="button"
        accessibilityState={{ expanded: isOpen }}
        className="flex-row items-center justify-between"
      >
        <Text className="font-sansMed text-sm text-primary">Budget another category</Text>
        <Ionicons name={isOpen ? 'chevron-up' : 'chevron-down'} size={14} color={colors.primary} />
      </Pressable>
      {isOpen ? (
        // The shadow sits on its own wrapper: iOS drops the shadow of a view that clips.
        <View style={[shadow.sm, { borderRadius: borderRadius.xl, backgroundColor: colors.surface }]}>
          <View className="overflow-hidden rounded-xl bg-surface">
            {items.map((category, index) => (
              <Pressable
                key={category.id}
                onPress={() => onSelect(category.id)}
                accessibilityRole="button"
                accessibilityLabel={`Set a budget for ${category.name}`}
                className="flex-row items-center gap-3 px-4 py-3.5"
                style={index > 0 ? { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border } : undefined}
              >
                <CategoryIcon icon={category.icon} size={18} color={category.color} />
                <Text className="flex-1 font-sansMed text-base text-textPrimary" numberOfLines={1}>
                  {category.name}
                </Text>
                <Text className="font-sansMed text-sm text-primary">Set</Text>
              </Pressable>
            ))}
          </View>
        </View>
      ) : null}
    </View>
  )
}
