import { useMemo, useState } from 'react'
import { Pressable, ScrollView, Switch, Text, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { colors, shadow } from '@/constants/theme'
import { useTransactionFeed } from '@/hooks/useTransactionFeed'
import { useBudgets } from '@/hooks/useBudgets'
import { useCategories } from '@/hooks/useCategories'
import { CategoryIcon } from '@/components/categories/CategoryIcon'
import { BudgetCard } from '@/components/budgets/BudgetCard'
import { BudgetSplitBar } from '@/components/budgets/BudgetSplitBar'
import { MonthNavigator } from '@/components/transactions/MonthNavigator'
import { BottomSheet, useSheetScroll } from '@/components/ui/BottomSheet'
import { TextField } from '@/components/ui/TextField'
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
} from '@/lib/budgets/budgetMath'

const ALERT_PRESETS = [50, 75, 90, 100]

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
  const [alertAmountText, setAlertAmountText] = useState('')
  const [isSaving, setIsSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)

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
      .sort((a, b) => b.spent / b.budget.amount - a.spent / a.budget.amount)
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

  const totalBudget = budgetedRows.reduce((sum, row) => sum + row.budget.amount, 0)
  const totalSpent = budgetedRows.reduce((sum, row) => sum + row.spent, 0)
  const totalRemaining = totalBudget - totalSpent
  const allowance = dailyAllowance(totalRemaining, month)
  const overallStatus = budgetStatus(totalSpent, totalBudget, elapsed)

  const editingBudget = editingCategoryId ? (resolved.get(editingCategoryId) ?? null) : null
  const editingCategory = editingCategoryId ? categoryById.get(editingCategoryId) : null
  const suggestion = useMemo(
    () => (editingCategoryId && !editingBudget ? suggestBudgetAmount(feed, editingCategoryId, month) : null),
    [feed, editingCategoryId, editingBudget, month],
  )

  const isValidAmount = /^\d+(\.\d{1,2})?$/.test(amountText) && Number(amountText) > 0
  const isValidAlertAmount =
    /^\d+(\.\d{1,2})?$/.test(alertAmountText) &&
    Number(alertAmountText) > 0 &&
    isValidAmount &&
    Number(alertAmountText) <= Number(amountText)
  const alertPercent = isValidAlertAmount ? toThresholdPercent(Number(alertAmountText), Number(amountText)) : null

  function openSheet(categoryId: string) {
    const existing = resolved.get(categoryId)
    setAmountText(existing ? String(existing.amount) : '')
    setAlertOn(existing?.alertThreshold != null)
    setAlertAmountText(
      existing?.alertThreshold != null ? toDollarText((existing.alertThreshold / 100) * existing.amount) : '',
    )
    setSaveError(null)
    setEditingCategoryId(categoryId)
  }

  function enableAlert(on: boolean) {
    setAlertOn(on)
    // Seed a sensible default so the box isn't empty the moment the toggle flips on.
    if (on && alertAmountText === '' && isValidAmount) setAlertAmountText(toDollarText(Number(amountText) * 0.9))
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
      <ScrollView contentInsetAdjustmentBehavior="automatic" contentContainerClassName="gap-4 px-5 py-4">
        <View className="flex-row items-center justify-between">
          <Text className="font-sansSemi text-lg text-textPrimary">Budgets</Text>
          <MonthNavigator month={month} onPrevious={() => setMonth(shiftMonth(month, -1))} onNext={() => setMonth(shiftMonth(month, 1))} onSelect={setMonth} />
        </View>

        {error ? <ErrorBanner message="Something went wrong loading your budgets." /> : null}

        {budgetedRows.length > 0 ? (
          <View className="gap-3 rounded-md bg-surface p-4" style={shadow.sm}>
            <View className="flex-row items-baseline justify-between">
              <Text className="font-sansSemi text-base text-textPrimary">Monthly budget</Text>
              <Text className="font-mono text-base text-textPrimary">{formatAmount(totalBudget)}</Text>
            </View>
            <BudgetSplitBar spent={totalSpent} amount={totalBudget} status={overallStatus} paceFraction={paceFraction} todayLabel />
            {allowance != null && totalRemaining > 0 ? (
              <Text className="font-sans text-sm text-textMuted">
                About <Text className="font-mono text-textSecondary">{formatAmount(allowance)}</Text> a day for the rest of the month.
              </Text>
            ) : null}
          </View>
        ) : (
          <EmptyState message="No budgets for this month yet. Pick a category below to set one." />
        )}

        <View className="gap-3">
          {budgetedRows.map(({ budget, spent, status }) => (
            <BudgetCard
              key={budget.budgetId}
              categoryName={categoryById.get(budget.categoryId)?.name ?? 'Unknown'}
              categoryIcon={categoryById.get(budget.categoryId)?.icon ?? null}
              categoryColor={categoryById.get(budget.categoryId)?.color}
              spent={spent}
              amount={budget.amount}
              status={status}
              paceFraction={paceFraction}
              onPress={() => openSheet(budget.categoryId)}
            />
          ))}
        </View>

        {unbudgetedCategories.length > 0 ? (
          <View className="gap-2">
            <Text className="font-sansMed text-sm text-textMuted">No budget set</Text>
            {unbudgetedCategories.map(({ category, typical }) => (
              <Pressable
                key={category.id}
                onPress={() => openSheet(category.id)}
                accessibilityRole="button"
                className="flex-row items-center justify-between rounded-md bg-surface p-4"
              >
                <View className="flex-1 flex-row items-center gap-2 pr-3">
                  <CategoryIcon icon={category.icon} size={18} color={category.color} />
                  <Text className="font-sansMed text-base text-textPrimary" numberOfLines={1}>
                    {category.name}
                  </Text>
                  {typical != null ? (
                    <Text className="font-sans text-xs text-textMuted">~{formatAmount(typical.amount)}/mo</Text>
                  ) : null}
                </View>
                <Text className="font-sansMed text-sm text-primary">Set</Text>
              </Pressable>
            ))}
          </View>
        ) : null}
      </ScrollView>

      <BottomSheet visible={editingCategoryId != null} onClose={() => setEditingCategoryId(null)} contentScroll={sheetScroll}>
        {/* Scrollable so the save button stays reachable when the keyboard shrinks the sheet. */}
        <ScrollView {...sheetScroll.scrollProps} className="px-5" contentContainerClassName="pb-8" keyboardShouldPersistTaps="handled">
          <View className="mb-5 flex-row items-center gap-3">
            {editingCategory ? <CategoryIcon icon={editingCategory.icon} size={34} color={editingCategory.color} /> : null}
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
          </View>

          {saveError ? (
            <View className="mb-4">
              <ErrorBanner message={saveError} onDismiss={() => setSaveError(null)} />
            </View>
          ) : null}

          <View className="gap-2">
            <TextField
              label="Monthly amount"
              value={amountText}
              onChangeText={setAmountText}
              keyboardType="decimal-pad"
              placeholder={suggestion != null ? String(suggestion.amount) : '200.00'}
              mono
            />
            {suggestion != null && !editingBudget ? (
              <Pressable onPress={() => setAmountText(String(suggestion.amount))}>
                <Text className="font-sans text-sm text-textMuted">
                  You've spent about <Text className="font-mono text-textSecondary">{formatAmount(suggestion.amount)}</Text> a month over the past{' '}
                  {suggestion.months === 1 ? 'month' : `${suggestion.months} months`} —{' '}
                  <Text className="font-sansMed text-primary">use it</Text>
                </Text>
              </Pressable>
            ) : null}
          </View>

          <View className="my-5 h-px bg-border" />

          <View className="gap-4">
            <View className="flex-row items-center justify-between">
              <View className="flex-1 pr-3">
                <Text className="font-sansMed text-base text-textPrimary">Notify me</Text>
                <Text className="font-sans text-xs text-textMuted">Get an alert when spending reaches your line.</Text>
              </View>
              <Switch value={alertOn} onValueChange={enableAlert} />
            </View>

            {alertOn ? (
              <View className="gap-2">
                <TextField
                  label="Alert me at"
                  value={alertAmountText}
                  onChangeText={setAlertAmountText}
                  keyboardType="decimal-pad"
                  placeholder={isValidAmount ? toDollarText(Number(amountText) * 0.9) : '450.00'}
                  mono
                />
                <View className="flex-row gap-2">
                  {ALERT_PRESETS.map((pct) => {
                    const isSelected = alertPercent === pct
                    return (
                      <Pressable
                        key={pct}
                        onPress={() => {
                          if (isValidAmount) setAlertAmountText(toDollarText(Number(amountText) * (pct / 100)))
                        }}
                        className={`flex-1 items-center rounded-full border px-3 py-1.5 ${
                          isSelected ? 'border-primary bg-primaryMuted' : 'border-border bg-surface'
                        }`}
                      >
                        <Text className={`font-sansMed text-sm ${isSelected ? 'text-primary' : 'text-textSecondary'}`}>
                          {pct}%
                        </Text>
                      </Pressable>
                    )
                  })}
                </View>
                {alertPercent != null ? (
                  <Text className="font-sans text-xs text-textMuted">
                    That&apos;s about {alertPercent}% of this budget.
                  </Text>
                ) : alertAmountText !== '' ? (
                  <Text className="font-sans text-xs text-textMuted">Pick an amount between $0 and your budget.</Text>
                ) : null}
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
