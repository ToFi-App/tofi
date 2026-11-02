import { useMemo, useState, type ReactNode } from 'react'
import { Pressable, ScrollView, Text, View, useWindowDimensions } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { colors } from '@/constants/theme'
import { formatMaskableAmount } from '@/lib/format/money'
import { useAmountsMasked } from '@/hooks/useAmountsMasked'
import type { FeedItem } from '@/lib/transactions/resolveFeed'
import type { YearMonth } from '@/lib/transactions/filterByMonth'
import { computeDonutSegments } from '@/lib/transactions/visualizationData'
import type { DonutSegment } from '@/lib/transactions/visualizationData'
import { CategoryDonut } from './CategoryDonut'
import { CategoryBreakdownRow } from './CategoryBreakdownRow'

type Mode = 'expense' | 'income'

const PAGE_PADDING = 20
const CARD_PADDING = 16

interface MonthChartsProps {
  monthFeed: FeedItem[]
  categories: Array<{ id: string; name: string; icon: string; color: string }>
  spendByCategory: Map<string, number>
  incomeByCategory: Map<string, number>
  totalExpense: number
  totalIncome: number
  month: YearMonth
  onSegmentPress: (segment: DonutSegment, mode: Mode) => void
}

/** The raised card the category chart sits on. */
function Card({ children, style }: { children: ReactNode; style?: object }) {
  return (
    <View
      className="rounded-lg bg-surface"
      style={[{ padding: CARD_PADDING, shadowColor: '#0F766E', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.08, shadowRadius: 16, elevation: 3 }, style]}
    >
      {children}
    </View>
  )
}

function ModeToggle({ mode, onChange }: { mode: Mode; onChange: (mode: Mode) => void }) {
  const options: Array<{ value: Mode; label: string; color: string }> = [
    { value: 'expense', label: 'Expenses', color: colors.expense },
    { value: 'income', label: 'Income', color: colors.income },
  ]
  return (
    <View className="flex-row rounded-full" style={{ backgroundColor: colors.surfaceRaised, padding: 2 }}>
      {options.map((option) => {
        const selected = option.value === mode
        return (
          <Pressable
            key={option.value}
            onPress={() => onChange(option.value)}
            accessibilityRole="button"
            accessibilityState={{ selected }}
            hitSlop={4}
            className="rounded-full px-3"
            style={[{ paddingVertical: 4 }, selected && { backgroundColor: colors.surface }]}
          >
            <Text className="font-sansSemi text-xs" style={{ color: selected ? option.color : colors.textSecondary }}>
              {option.label}
            </Text>
          </Pressable>
        )
      })}
    </View>
  )
}

/**
 * Home's Charts view: the month by category — a donut with the total in its hole, switched between
 * expenses and income from the card's header — with the category rows under it. The spending pace
 * against last month lives on the Summary view.
 */
export function MonthCharts({
  monthFeed,
  categories,
  spendByCategory,
  incomeByCategory,
  totalExpense,
  totalIncome,
  month,
  onSegmentPress,
}: MonthChartsProps) {
  const insets = useSafeAreaInsets()
  const { width } = useWindowDimensions()
  const [mode, setMode] = useState<Mode>('expense')
  const { isMasked } = useAmountsMasked()

  const amountByCategory = mode === 'expense' ? spendByCategory : incomeByCategory
  const total = mode === 'expense' ? totalExpense : totalIncome

  const segments = useMemo(
    () => computeDonutSegments(monthFeed, amountByCategory, categories, total, mode),
    [monthFeed, amountByCategory, categories, total, mode],
  )

  // Keyed on the segments rather than the total: a month whose every transaction is excluded has a
  // total of zero but still has rows the user should be able to reach, and those segments carry
  // them. Genuinely empty months have no segments either, so the label still shows when it should.
  const isEmpty = segments.length === 0

  const monthName = new Date(month.year, month.month - 1, 1).toLocaleDateString('en-US', { month: 'long' })
  const emptyLabel = mode === 'expense' ? 'No spending this month' : 'No income this month'
  // The card's inner width; the donut's side labels need all of it.
  const donutSize = Math.min(width - 2 * PAGE_PADDING - 2 * CARD_PADDING, 320)

  return (
    // The bottom inset clears the floating tab bar.
    <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingHorizontal: PAGE_PADDING, paddingBottom: insets.bottom + 88 }}>
      <Card style={{ marginTop: 8 }}>
        <View className="flex-row items-center justify-between">
          <Text className="font-sansSemi text-base" style={{ color: colors.textPrimary }}>
            By category
          </Text>
          <ModeToggle mode={mode} onChange={setMode} />
        </View>

        {isEmpty ? (
          <View style={{ paddingVertical: 48, alignItems: 'center' }}>
            <Text className="font-sans text-base text-textMuted">{emptyLabel}</Text>
          </View>
        ) : (
          <View style={{ marginTop: 4 }}>
            <CategoryDonut
              segments={segments}
              size={donutSize}
              onSegmentPress={(seg) => onSegmentPress(seg, mode)}
              center={
                <>
                  <Text
                    className="font-display text-md"
                    style={{ color: mode === 'expense' ? colors.expense : colors.income }}
                    numberOfLines={1}
                    adjustsFontSizeToFit
                  >
                    {formatMaskableAmount(total, isMasked)}
                  </Text>
                  <Text className="font-sans text-xs text-textSecondary" numberOfLines={1} adjustsFontSizeToFit>
                    {mode === 'expense' ? 'spent' : 'earned'} in {monthName}
                  </Text>
                </>
              }
            />
          </View>
        )}
      </Card>

      {isEmpty ? null : (
        <View style={{ marginTop: 12 }}>
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
        </View>
      )}
    </ScrollView>
  )
}
