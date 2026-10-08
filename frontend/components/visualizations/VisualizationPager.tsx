import { useRef, useMemo, useState } from 'react'
import { ScrollView, Text, View, useWindowDimensions } from 'react-native'
import type { NativeScrollEvent, NativeSyntheticEvent } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { colors } from '@/constants/theme'
import type { FeedItem } from '@/lib/transactions/resolveFeed'
import type { YearMonth } from '@/lib/transactions/filterByMonth'
import { computeDonutSegments, computeDailyPoints, computeTopMerchants } from '@/lib/transactions/visualizationData'
import type { DonutSegment } from '@/lib/transactions/visualizationData'
import { CategoryDonut } from './CategoryDonut'
import { SpendingTrend } from './SpendingTrend'
import { ExpenseIncomeSummary } from './ExpenseIncomeSummary'
import { CategoryBreakdownRow } from './CategoryBreakdownRow'
import { TopMerchants } from './TopMerchants'

interface VisualizationPagerProps {
  monthFeed: FeedItem[]
  categories: Array<{ id: string; name: string; icon: string; color: string }>
  spendByCategory: Map<string, number>
  incomeByCategory: Map<string, number>
  totalExpense: number
  totalIncome: number
  month: YearMonth
  onSegmentPress: (segment: DonutSegment, mode: 'expense' | 'income') => void
}

export function VisualizationPager({
  monthFeed,
  categories,
  spendByCategory,
  incomeByCategory,
  totalExpense,
  totalIncome,
  month,
  onSegmentPress,
}: VisualizationPagerProps) {
  const { width } = useWindowDimensions()
  const insets = useSafeAreaInsets()
  const [mode, setMode] = useState<'expense' | 'income'>('expense')
  const [pageIndex, setPageIndex] = useState(0)
  const scrollRef = useRef<ScrollView>(null)

  const amountByCategory = mode === 'expense' ? spendByCategory : incomeByCategory
  const total = mode === 'expense' ? totalExpense : totalIncome

  const segments = useMemo(
    () => computeDonutSegments(monthFeed, amountByCategory, categories, total, mode),
    [monthFeed, amountByCategory, categories, total, mode],
  )

  const dailyPoints = useMemo(() => computeDailyPoints(monthFeed, month, mode), [monthFeed, month, mode])
  const topMerchants = useMemo(() => computeTopMerchants(monthFeed, mode), [monthFeed, mode])

  const lineColor = mode === 'expense' ? colors.expense : colors.income
  // Keyed on the segments rather than the total: a month whose every transaction is excluded has a
  // total of zero but still has rows the user should be able to reach, and those segments carry
  // them. Genuinely empty months have no segments either, so the label still shows when it should.
  const isEmpty = segments.length === 0

  function handleScroll(e: NativeSyntheticEvent<NativeScrollEvent>) {
    const idx = Math.round(e.nativeEvent.contentOffset.x / width)
    if (idx !== pageIndex) setPageIndex(idx)
  }

  const emptyLabel = mode === 'expense' ? 'No spending this month' : 'No income this month'

  return (
    <View style={{ flex: 1 }}>
      <ScrollView
        ref={scrollRef}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        onScroll={handleScroll}
        scrollEventThrottle={16}
      >
        {/* Page 1: Donut */}
        <ScrollView style={{ width }} contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 80 }} nestedScrollEnabled>
          {isEmpty ? (
            <View style={{ paddingVertical: 80, alignItems: 'center' }}>
              <Text className="font-sans text-base text-textMuted">{emptyLabel}</Text>
            </View>
          ) : (
            <>
              <CategoryDonut segments={segments} onSegmentPress={(seg) => onSegmentPress(seg, mode)} />

              <View style={{ marginTop: 16 }}>
                <ExpenseIncomeSummary mode={mode} onToggle={setMode} totalExpense={totalExpense} totalIncome={totalIncome} />
              </View>

              <View className="bg-border" style={{ height: 1, marginVertical: 16 }} />

              {segments.map((seg) => (
                <CategoryBreakdownRow
                  key={seg.categoryId}
                  icon={seg.icon}
                  name={seg.name}
                  color={seg.color}
                  percentage={seg.percentage}
                  amount={seg.amount}
                  transactionCount={seg.transactionCount}
                  onPress={() => onSegmentPress(seg, mode)}
                />
              ))}
            </>
          )}
        </ScrollView>

        {/* Page 2: Trend */}
        <ScrollView style={{ width }} contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 80 }} nestedScrollEnabled>
          {isEmpty ? (
            <View style={{ paddingVertical: 80, alignItems: 'center' }}>
              <Text className="font-sans text-base text-textMuted">{emptyLabel}</Text>
            </View>
          ) : (
            <>
              <View
                className="rounded-lg bg-surface"
                style={{ padding: 12, marginTop: 8, shadowColor: '#0F766E', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.08, shadowRadius: 16, elevation: 3 }}
              >
                <SpendingTrend points={dailyPoints} lineColor={lineColor} month={month} />
              </View>

              <View style={{ marginTop: 20 }}>
                <ExpenseIncomeSummary mode={mode} onToggle={setMode} totalExpense={totalExpense} totalIncome={totalIncome} />
              </View>

              <View
                className="rounded-lg bg-surface"
                style={{ padding: 12, marginTop: 16, shadowColor: '#0F766E', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.08, shadowRadius: 16, elevation: 3 }}
              >
                <TopMerchants merchants={topMerchants} barColor={lineColor} />
              </View>
            </>
          )}
        </ScrollView>
      </ScrollView>

      {/* Dot indicators — the bottom inset clears the floating tab bar, the 52 the toggle pill above it */}
      <View style={{ flexDirection: 'row', justifyContent: 'center', gap: 6, paddingBottom: insets.bottom + 52 }}>
        {[0, 1].map((i) => (
          <View
            key={i}
            style={{
              width: i === pageIndex ? 16 : 6,
              height: 6,
              borderRadius: 3,
              backgroundColor: i === pageIndex ? colors.primary : colors.border,
            }}
          />
        ))}
      </View>
    </View>
  )
}
