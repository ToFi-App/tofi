import { useCallback, useMemo, useState } from 'react'
import { Pressable, ScrollView, Text, View } from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import { SafeAreaView } from 'react-native-safe-area-context'
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router'
import { colors, hexToRgba } from '@/constants/theme'
import { useTransactionFeed } from '@/hooks/useTransactionFeed'
import { useBudgets } from '@/hooks/useBudgets'
import { useCategories } from '@/hooks/useCategories'
import { AmountInput } from '@/components/budgets/AmountInput'
import { AlertLevelPicker, AlertLine, type AlertLevel } from '@/components/budgets/AlertLevelPicker'
import { AmountChip, BudgetRow, CategoryWell, RowGroup, SuggestionChip } from '@/components/budgets/BudgetRows'
import { MonthNavigator } from '@/components/transactions/MonthNavigator'
import { GlassButton } from '@/components/ui/GlassButton'
import { HeroSurfaceContext } from '@/components/ui/HeroGlass'
import { BottomSheet, useSheetScroll } from '@/components/ui/BottomSheet'
import { TextField } from '@/components/ui/TextField'
import { Button } from '@/components/ui/Button'
import { ErrorBanner } from '@/components/ui/ErrorBanner'
import { EmptyState } from '@/components/ui/EmptyState'
import { LoadingScreen } from '@/components/ui/LoadingScreen'
import { ensureNotificationPermission } from '@/lib/notifications/permission'
import { formatAmount } from '@/lib/format/money'
import { filterByMonth, monthFromParams, shiftMonth, type YearMonth } from '@/lib/transactions/filterByMonth'
import { dailyAllowance, monthElapsedFraction, monthKey, resolveBudgetsForMonth, suggestBudgetAmount } from '@/lib/budgets/budgetMath'
import { aggregateMonth } from '@/lib/transactions/aggregateMonth'
import { BudgetPaceRing } from '@/components/budgets/BudgetPaceRing'
import { TabBarSpacer } from '@/components/navigation/FloatingTabs'

const ALERT_PRESETS = [50, 75, 90, 100]
const DEFAULT_ALERT_PRESET = 90

/** Dollars → whole-percent-of-budget, the unit alerts are stored in (they scale with edits). */
function toThresholdPercent(alertDollars: number, budgetDollars: number): number {
  return Math.min(100, Math.max(1, Math.round((alertDollars / budgetDollars) * 100)))
}

/** The stepper's increment: a step that moves a budget of this size by a few percent. */
function stepFor(amount: number): number {
  if (amount < 100) return 5
  if (amount < 500) return 10
  if (amount < 2000) return 25
  return 100
}

function toDollarText(n: number): string {
  return String(Math.round(n * 100) / 100)
}

/**
 * Setting budgets, pushed from Home's overview card. Home shows how the month is going against
 * them; this screen is only about the plan: the total, how it splits across categories, and each
 * amount as a chip to tap and change. Below, the categories not budgeted yet, with what each usually
 * costs as a ready-made amount.
 */
export default function BudgetsScreen() {
  const sheetScroll = useSheetScroll()
  const params = useLocalSearchParams<{ year?: string; month?: string }>()
  const [month, setMonth] = useState<YearMonth>(() => monthFromParams(params))
  // Opens on the month Home was showing, not whichever was browsed here last time.
  useFocusEffect(
    useCallback(() => {
      setMonth(monthFromParams({ year: params.year, month: params.month }))
    }, [params.year, params.month]),
  )
  const [editingCategoryId, setEditingCategoryId] = useState<string | null>(null)
  const [amountText, setAmountText] = useState('')
  const [alertOn, setAlertOn] = useState(false)
  // A preset percentage, or null for a custom alert entered in dollars (alertAmountText).
  const [alertPreset, setAlertPreset] = useState<number | null>(DEFAULT_ALERT_PRESET)
  const [alertAmountText, setAlertAmountText] = useState('')
  const [isSaving, setIsSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [showOtherCategories, setShowOtherCategories] = useState(false)

  const { feed, isLoading, error } = useTransactionFeed()
  const budgets = useBudgets()
  const categories = useCategories()

  const categoryById = useMemo(() => new Map((categories.data ?? []).map((c) => [c.id, c])), [categories.data])

  // Budgets are effective-dated: the viewed month sees whatever amount was in force then, so
  // browsing back never rewrites history with today's numbers.
  const resolved = useMemo(() => resolveBudgetsForMonth(budgets.data ?? [], month), [budgets.data, month])

  // Largest first, so the biggest budgets lead the list. A budget
  // whose category has since been deleted has nothing to show or edit, so it's left out.
  const budgetedRows = useMemo(
    () =>
      [...resolved.values()]
        .flatMap((budget) => {
          const category = categoryById.get(budget.categoryId)
          return category ? [{ budget, category }] : []
        })
        .sort((a, b) => b.budget.amount - a.budget.amount),
    [resolved, categoryById],
  )
  const totalBudget = budgetedRows.reduce((sum, row) => sum + row.budget.amount, 0)

  // How the month is tracking against those budgets, counted the way Home's Budget card counts it:
  // each budgeted category's own spending.
  const { spendByCategory } = useMemo(() => aggregateMonth(filterByMonth(feed, month)), [feed, month])
  const totalSpent = budgetedRows.reduce((sum, row) => sum + (spendByCategory.get(row.budget.categoryId) ?? 0), 0)
  const elapsed = monthElapsedFraction(month)
  const isCurrentMonth = elapsed > 0 && elapsed < 1
  const daysLeft = isCurrentMonth ? new Date(month.year, month.month, 0).getDate() - new Date().getDate() + 1 : null

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

  const editingBudget = editingCategoryId ? (resolved.get(editingCategoryId) ?? null) : null
  const editingCategory = editingCategoryId ? categoryById.get(editingCategoryId) : null
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
    // A new budget starts on what the category usually costs, so saving it as-is is one tap.
    const typical = existing ? null : suggestBudgetAmount(feed, categoryId, month)
    setAmountText(existing ? String(existing.amount) : typical ? String(typical.amount) : '')
    setAlertOn(threshold != null)
    // A saved threshold off the presets reopens as the custom amount it was set as.
    const isCustom = threshold != null && !ALERT_PRESETS.includes(threshold)
    setAlertPreset(isCustom ? null : (threshold ?? DEFAULT_ALERT_PRESET))
    setAlertAmountText(isCustom && existing ? toDollarText((threshold / 100) * existing.amount) : '')
    setSaveError(null)
    setEditingCategoryId(categoryId)
  }

  const alertLevel: AlertLevel = !alertOn ? 'off' : (alertPreset ?? 'custom')

  function chooseAlertLevel(level: AlertLevel) {
    if (level === 'off') {
      setAlertOn(false)
      return
    }
    setAlertOn(true)
    if (level === 'custom') {
      // Start from the line the preset drew, so switching to custom is a nudge rather than a blank.
      if (alertAmountText === '' && alertDollars != null) setAlertAmountText(toDollarText(alertDollars))
      setAlertPreset(null)
      return
    }
    setAlertPreset(level)
  }

  function stepAmount(direction: 1 | -1) {
    const current = budgetAmount ?? (amountText === '' && suggestion != null ? suggestion.amount : 0)
    const step = stepFor(direction < 0 ? Math.max(0, current - 1) : current)
    // Snaps to the step first, so $612 steps to $625 or $600 rather than $637 or $587.
    const next = direction > 0 ? Math.floor(current / step) * step + step : Math.ceil(current / step) * step - step
    setAmountText(String(Math.max(0, next)))
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
        {/* The same header as the Expenses / Income page: a round back button, the month as a pill
            centred on the row. White chips here, on the plain page. */}
        <HeroSurfaceContext.Provider value="plain">
          <View className="flex-row items-center justify-between">
            <View pointerEvents="box-none" className="absolute bottom-0 left-0 right-0 top-0 items-center justify-center">
              <MonthNavigator
                variant="pill"
                month={month}
                onPrevious={() => setMonth(shiftMonth(month, -1))}
                onNext={() => setMonth(shiftMonth(month, 1))}
                onSelect={setMonth}
              />
            </View>
            <GlassButton onPress={() => router.back()} accessibilityLabel="Back">
              <Ionicons name="chevron-back" size={20} color={colors.textPrimary} />
            </GlassButton>
          </View>
        </HeroSurfaceContext.Provider>

        {error ? <ErrorBanner message="Something went wrong loading your budgets." /> : null}

        {/* How the month is going against the plan, above the plan itself. */}
        {budgetedRows.length > 0 ? (
          <BudgetPaceRing
            totalBudget={totalBudget}
            totalSpent={totalSpent}
            elapsed={elapsed}
            daysLeft={daysLeft}
            dailyAllowance={dailyAllowance(totalBudget - totalSpent, month)}
            segments={budgetedRows
              .map(({ budget, category }) => ({
                id: budget.budgetId,
                name: category.name,
                color: category.color,
                spent: spendByCategory.get(budget.categoryId) ?? 0,
              }))
              .sort((a, b) => b.spent - a.spent)}
          />
        ) : null}


        {budgetedRows.length > 0 ? (
          <RowGroup>
            {budgetedRows.map(({ budget, category }, index) => (
              <BudgetRow
                key={budget.budgetId}
                category={category}
                isFirst={index === 0}
                onPress={() => openSheet(category.id)}
                accessibilityLabel={`${category.name}, ${budget.amount} a month. Edit`}
                trailing={<AmountChip amount={budget.amount} color={category.color} />}
              />
            ))}
          </RowGroup>
        ) : null}

        {suggestedCategories.length + otherCategories.length > 0 ? (
          <View className="gap-3">
            <Text className="font-sansSemi text-md text-textPrimary">Add a budget</Text>
            <RowGroup>
              {suggestedCategories.map(({ category, typical }, index) => (
                <BudgetRow
                  key={category.id}
                  category={category}
                  isFirst={index === 0}
                  onPress={() => openSheet(category.id)}
                  accessibilityLabel={`Budget ${category.name}, usually ${Math.round(typical)} a month`}
                  trailing={<SuggestionChip amount={typical} color={category.color} />}
                />
              ))}
              {/* Categories with no spending to suggest from wait behind one row. With nothing above
                  them to tap they're the only way in, so then they show. */}
              {showOtherCategories || suggestedCategories.length === 0
                ? otherCategories.map(({ category }, index) => (
                    <BudgetRow
                      key={category.id}
                      category={category}
                      isFirst={suggestedCategories.length === 0 && index === 0}
                      onPress={() => openSheet(category.id)}
                      accessibilityLabel={`Budget ${category.name}`}
                      trailing={<SuggestionChip amount={null} color={category.color} />}
                    />
                  ))
                : null}
              {otherCategories.length > 0 && suggestedCategories.length > 0 ? (
                <Pressable
                  onPress={() => setShowOtherCategories((v) => !v)}
                  accessibilityRole="button"
                  accessibilityState={{ expanded: showOtherCategories }}
                  className="flex-row items-center justify-between border-t px-4 py-3.5"
                  style={{ borderTopColor: colors.border }}
                >
                  <Text className="font-sansMed text-base text-primary">
                    {showOtherCategories ? 'Fewer categories' : `${otherCategories.length} more categories`}
                  </Text>
                  <Ionicons name={showOtherCategories ? 'chevron-up' : 'chevron-down'} size={16} color={colors.primary} />
                </Pressable>
              ) : null}
            </RowGroup>
          </View>
        ) : null}
        <TabBarSpacer />
      </ScrollView>

      <BottomSheet visible={editingCategoryId != null} onClose={() => setEditingCategoryId(null)} contentScroll={sheetScroll}>
        {/* Scrollable so the save button stays reachable when the keyboard shrinks the sheet. */}
        <ScrollView {...sheetScroll.scrollProps} className="px-5" contentContainerClassName="pb-8" keyboardShouldPersistTaps="handled">
          {/* The row the user tapped, opened up: its badge and name, and — for a budget that
              exists — the way to stop it. */}
          <View className="mb-5 flex-row items-center gap-3">
            {editingCategory ? <CategoryWell category={editingCategory} size={44} /> : null}
            <Text className="flex-1 font-sansSemi text-md text-textPrimary" numberOfLines={1}>
              {editingCategory?.name ?? 'Set budget'}
            </Text>
            {editingBudget ? (
              <Pressable onPress={() => save(null)} disabled={isSaving} hitSlop={8} accessibilityRole="button" className="rounded-full px-3 py-1.5" style={{ backgroundColor: hexToRgba(colors.expense, 0.1) }}>
                <Text className="font-sansSemi text-sm text-expense">Remove</Text>
              </Pressable>
            ) : null}
          </View>

          {saveError ? (
            <View className="mb-4">
              <ErrorBanner message={saveError} onDismiss={() => setSaveError(null)} />
            </View>
          ) : null}

          {/* The amount on the category's own tint: type it, or step it without the keyboard. */}
          <View className="items-center gap-3 rounded-2xl px-4 py-6" style={{ backgroundColor: hexToRgba(editingCategory?.color ?? colors.primary, 0.12) }}>
            <View className="w-full flex-row items-center justify-between">
              <StepButton icon="remove" label="Lower the budget" onPress={() => stepAmount(-1)} disabled={(budgetAmount ?? 0) <= 0} />
              <AmountInput
                value={amountText}
                onChangeText={setAmountText}
                placeholder={suggestion != null ? String(suggestion.amount) : '0'}
                accessibilityLabel="Monthly budget"
              />
              <StepButton icon="add" label="Raise the budget" onPress={() => stepAmount(1)} />
            </View>
            {budgetAmount != null ? (
              <Text className="font-mono text-sm text-textSecondary">{formatAmount(budgetAmount / daysInViewedMonth)}/day</Text>
            ) : null}
            {/* Where the starting amount came from, while it's still the one shown. */}
            {suggestion != null && !editingBudget && amountText === String(suggestion.amount) ? (
              <Text className="font-sansMed text-sm text-textSecondary">
                {suggestion.months === 1 ? 'Last month' : `${suggestion.months}-month average`}
              </Text>
            ) : null}
          </View>

          <View className="mt-6 gap-4">
            <Text className="font-sansSemi text-base text-textPrimary">Alert at</Text>
            <AlertLevelPicker presets={ALERT_PRESETS} value={alertLevel} onChange={chooseAlertLevel} disabled={budgetAmount == null} />
            {alertOn && alertPreset == null ? (
              <TextField
                label="Alert amount"
                value={alertAmountText}
                onChangeText={setAlertAmountText}
                keyboardType="decimal-pad"
                placeholder={budgetAmount != null ? toDollarText(budgetAmount * 0.9) : '450.00'}
                mono
              />
            ) : null}
            {alertOn && budgetAmount != null ? (
              alertDollars != null ? (
                <AlertLine alertDollars={alertDollars} budget={budgetAmount} color={editingCategory?.color ?? colors.primary} />
              ) : (
                // What's holding the button back, in amber.
                <Text className="font-sansMed text-sm text-warning">Up to {formatAmount(budgetAmount)}</Text>
              )
            ) : null}
          </View>

          <View className="mt-8">
            <Button
              label={editingBudget ? 'Save changes' : 'Set budget'}
              onPress={() => save(amountText)}
              disabled={!isValidAmount || (alertOn && alertPercent == null) || isSaving}
            />
          </View>
        </ScrollView>
      </BottomSheet>
    </SafeAreaView>
  )
}

function StepButton({
  icon,
  label,
  onPress,
  disabled = false,
}: {
  icon: 'add' | 'remove'
  label: string
  onPress: () => void
  disabled?: boolean
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={label}
      hitSlop={6}
      className="h-11 w-11 items-center justify-center rounded-full"
      style={{ backgroundColor: colors.surface, opacity: disabled ? 0.4 : 1 }}
    >
      <Ionicons name={icon} size={22} color={colors.textPrimary} />
    </Pressable>
  )
}
