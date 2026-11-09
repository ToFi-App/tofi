import { useMemo } from 'react'
import { ScrollView, Text, View, useWindowDimensions } from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import { SafeAreaView } from 'react-native-safe-area-context'
import { router, useLocalSearchParams } from 'expo-router'
import { colors, heroGradient } from '@/constants/theme'
import { formatMaskableAmount } from '@/lib/format/money'
import { aggregateMonth } from '@/lib/transactions/aggregateMonth'
import { filterByMonth, shiftMonth, type YearMonth } from '@/lib/transactions/filterByMonth'
import { useAmountsMasked } from '@/hooks/useAmountsMasked'
import { useSelectedMonth } from '@/hooks/useSelectedMonth'
import { useTransactionFeed } from '@/hooks/useTransactionFeed'
import { useMonthCategories } from '@/hooks/useMonthCategories'
import { HeroBackground } from '@/components/home/HeroBackground'
import { TileRows } from '@/components/home/TileRows'
import { MonthNavigator } from '@/components/transactions/MonthNavigator'
import { Card } from '@/components/ui/Card'
import { GlassButton } from '@/components/ui/GlassButton'
import { PageBackdrop } from '@/components/ui/PageBackdrop'
import { CategoryDetailSheet } from '@/components/visualizations/CategoryDetailSheet'
import { TabBarSpacer } from '@/components/navigation/FloatingTabs'

const SCREEN_PADDING = 20
const TILE_GAP = 10
const TILE_HEIGHT = 116
/** How far the sheet of tiles rides up over the bottom of the top section, as on Home. */
const SHEET_OVERLAP = 24
const SHEET_RADIUS = 28
const BAR_HEIGHT = 12
/** Under a cent either way is level. */
const LEVEL = 0.005
const TABULAR = { fontVariant: ['tabular-nums' as const] }
/** The pills on the mint section: the same quiet white veil as Home's In/Out pills. */
const PILL = { backgroundColor: 'rgba(255,255,255,0.75)' }
const SHEET_CORNERS = { borderTopLeftRadius: SHEET_RADIUS, borderTopRightRadius: SHEET_RADIUS }

function monthName(month: YearMonth, style: 'long' | 'short'): string {
  return new Date(month.year, month.month - 1, 1).toLocaleDateString('en-US', { month: style })
}

/** A category's share as the legend prints it; a real sliver says "<1%" rather than 0%. */
function shareLabel(share: number): string {
  const pct = share * 100
  return pct > 0 && pct < 1 ? '<1%' : `${Math.round(pct)}%`
}

/**
 * Every expense or income category for the month, pushed from the preview card on Home. Home's mint
 * top section — the month's total, against last month and (for expenses) the budget — then, on the
 * sheet, how the total splits by category and the full grid of tiles, budget rings and all. Home's
 * month and account filter, and a tile opens the same detail sheet.
 */
export default function CategoriesScreen() {
  const { mode } = useLocalSearchParams<{ mode?: string }>()
  const isIncome = mode === 'income'
  const { isMasked } = useAmountsMasked()
  const { feed } = useTransactionFeed()
  const [, setMonth] = useSelectedMonth()
  const { month, accountFilteredFeed, spendByCategory, totalExpense, totalIncome, resolvedBudgets, expenseTiles, incomeTiles, detail } =
    useMonthCategories()
  const { width, height } = useWindowDimensions()
  const tileWidth = (width - SCREEN_PADDING * 2 - TILE_GAP * 2) / 3

  const tiles = isIncome ? incomeTiles : expenseTiles
  const total = isIncome ? totalIncome : totalExpense
  const previousMonth = shiftMonth(month, -1)

  const previousTotal = useMemo(() => {
    const totals = aggregateMonth(filterByMonth(accountFilteredFeed, previousMonth))
    return isIncome ? totals.totalIncome : totals.totalExpense
  }, [accountFilteredFeed, previousMonth.year, previousMonth.month, isIncome])
  const change = total - previousTotal

  // What's left of the month's budgets, counted the way Home's Budget card counts it: each budgeted
  // category's limit against its own spending.
  const budgetLeft = useMemo(() => {
    if (isIncome || resolvedBudgets.size === 0) return null
    let left = 0
    for (const resolved of resolvedBudgets.values()) left += resolved.amount - (spendByCategory.get(resolved.categoryId) ?? 0)
    return left
  }, [isIncome, resolvedBudgets, spendByCategory])

  // Largest first for the split; zero-amount categories have nothing to draw.
  const ranked = [...tiles].filter((t) => t.spent > 0).sort((a, b) => b.spent - a.spent)

  // Up is bad for spending and good for income; level says so in neither colour.
  const isLevel = Math.abs(change) < LEVEL
  const changeColor = isLevel ? colors.textPrimary : (change > 0) !== isIncome ? colors.expense : colors.income

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: heroGradient.stops[0] }} edges={['top']}>
      <ScrollView>
        {/* The top section, on Home's mint: back, title and month across the top, the total under it. */}
        <View style={{ paddingHorizontal: SCREEN_PADDING, paddingTop: 8, paddingBottom: SHEET_OVERLAP + 28, gap: 20 }}>
          <HeroBackground />
          <View className="flex-row items-center justify-between">
            {/* The month, centred on the row itself rather than between its neighbours — as Home
                centres its month pill. "Spent in" / "Earned in" under it says which page this is. */}
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
              <Ionicons name="chevron-back" size={20} color={heroGradient.ink} />
            </GlassButton>
          </View>

          <View className="items-center gap-2">
            <Text className="font-sansSemi text-sm" style={{ color: heroGradient.ink }}>
              {isIncome ? 'Earned' : 'Spent'} in {monthName(month, 'long')}
            </Text>
            <Text className="font-display text-3xl" style={[TABULAR, { color: heroGradient.ink, letterSpacing: -0.8 }]}>
              {formatMaskableAmount(total, isMasked)}
            </Text>
            <View className="flex-row flex-wrap justify-center gap-2">
              {previousTotal > 0 ? (
                <View className="flex-row items-center gap-1 rounded-full px-3 py-1.5" style={PILL}>
                  {isLevel ? null : <Ionicons name={change > 0 ? 'caret-up' : 'caret-down'} size={11} color={changeColor} />}
                  <Text className="font-sansMed text-sm" style={[TABULAR, { color: changeColor }]}>
                    {isLevel ? 'Same as' : formatMaskableAmount(Math.abs(change), isMasked) + ' vs'} {monthName(previousMonth, 'short')}
                  </Text>
                </View>
              ) : null}
              {budgetLeft != null ? (
                <View className="rounded-full px-3 py-1.5" style={PILL}>
                  <Text className="font-sansMed text-sm" style={[TABULAR, { color: budgetLeft < 0 ? colors.expense : colors.textPrimary }]}>
                    {formatMaskableAmount(Math.abs(budgetLeft), isMasked)} {budgetLeft < 0 ? 'over budget' : 'budget left'}
                  </Text>
                </View>
              ) : null}
            </View>
          </View>
        </View>

        {/* The sheet, riding up over the top section as Home's does. */}
        <View
          style={{
            marginTop: -SHEET_OVERLAP,
            minHeight: height,
            paddingHorizontal: SCREEN_PADDING,
            paddingTop: 20,
            gap: 16,
          }}
        >
          {/* Carries the sheet's rounded top corners itself, as on Home. */}
          <PageBackdrop variant="sheet" rim cornerStyle={SHEET_CORNERS} />

          {ranked.length > 0 ? (
            <Card style={{ padding: 16, gap: 10 }}>
              <Text className="font-sansSemi text-base text-textPrimary">{isIncome ? 'Where it came from' : 'Where it went'}</Text>
              <View className="flex-row overflow-hidden rounded-full" style={{ height: BAR_HEIGHT, gap: 2 }}>
                {ranked.map((t) => (
                  <View key={t.id} style={{ flex: t.spent, backgroundColor: t.color }} />
                ))}
              </View>
              <View className="flex-row flex-wrap" style={{ columnGap: 12, rowGap: 4 }}>
                {ranked.map((t) => (
                  <View key={t.id} className="flex-row items-center gap-1.5">
                    <View style={{ width: 9, height: 9, borderRadius: 2, backgroundColor: t.color }} />
                    <Text className="font-sans text-sm text-textSecondary">
                      {t.name} {total > 0 ? shareLabel(t.spent / total) : ''}
                    </Text>
                  </View>
                ))}
              </View>
            </Card>
          ) : null}

          {tiles.length > 0 ? (
            <TileRows tiles={tiles} tileWidth={tileWidth} tileHeight={TILE_HEIGHT} gap={TILE_GAP} />
          ) : (
            <Text className="font-sans text-base text-textMuted">
              {isIncome ? 'No income this month' : 'No spending this month'}
            </Text>
          )}
          <TabBarSpacer />
        </View>
      </ScrollView>

      <CategoryDetailSheet {...detail} feed={feed} />
    </SafeAreaView>
  )
}
