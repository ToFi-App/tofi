import type { ReactNode } from 'react'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import { borderRadius, colors, hexToRgba, shadow } from '@/constants/theme'
import { CategoryIcon } from '@/components/categories/CategoryIcon'

const WELL = 40
const ALLOCATION_BAR = 10

/** Whole dollars: a budget is a round number, and cents on every row are noise. */
export function budgetDollars(amount: number): string {
  return `$${Math.round(amount).toLocaleString('en-US')}`
}

interface CategoryLike {
  id: string
  name: string
  icon: string | null
  color: string
}

/** The category's two-tone badge — Home's icon well, at list size. */
export function CategoryWell({ category, size = WELL }: { category: CategoryLike; size?: number }) {
  return (
    <View className="items-center justify-center rounded-full" style={{ width: size, height: size, backgroundColor: hexToRgba(category.color, 0.22) }}>
      <CategoryIcon icon={category.icon} size={Math.round(size * 0.45)} color={category.color} />
    </View>
  )
}

/**
 * The month's budgets summed, and how that total splits: one bar cut into each budget's share in
 * its category colour. The rows under it are the legend, in the same order.
 */
export function BudgetTotal({ total, slices }: { total: number; slices: Array<{ id: string; color: string; amount: number }> }) {
  return (
    <View className="gap-4">
      <View className="gap-1">
        <Text className="font-sansSemi text-base text-textPrimary">Monthly budget</Text>
        <Text className="font-display text-3xl text-textPrimary">{budgetDollars(total)}</Text>
      </View>
      <View className="flex-row overflow-hidden rounded-full" style={{ height: ALLOCATION_BAR, gap: 2, backgroundColor: colors.surfaceRaised }}>
        {slices.map((slice) => (
          <View key={slice.id} style={{ flex: slice.amount, backgroundColor: slice.color }} />
        ))}
      </View>
    </View>
  )
}

/** A white surface holding rows, hairlines between them. */
export function RowGroup({ children }: { children: ReactNode }) {
  return (
    // The shadow sits on its own wrapper: iOS drops the shadow of a view that clips.
    <View style={[shadow.sm, { borderRadius: borderRadius.xl, backgroundColor: colors.surface }]}>
      <View className="overflow-hidden rounded-xl bg-surface">{children}</View>
    </View>
  )
}

interface BudgetRowProps {
  category: CategoryLike
  isFirst: boolean
  onPress: () => void
  /** The right-hand control: an AmountChip, a suggestion, or nothing. */
  trailing: ReactNode
  accessibilityLabel: string
}

export function BudgetRow({ category, isFirst, onPress, trailing, accessibilityLabel }: BudgetRowProps) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      className="flex-row items-center gap-3 px-4 py-3"
      style={isFirst ? undefined : { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border }}
    >
      <CategoryWell category={category} />
      <Text className="flex-1 font-sansMed text-base text-textPrimary" numberOfLines={1}>
        {category.name}
      </Text>
      {trailing}
    </Pressable>
  )
}

/**
 * The budgeted amount as a tinted chip in the category's colour — shaped like something to tap,
 * because tapping it is how the amount changes.
 */
export function AmountChip({ amount, color }: { amount: number; color: string }) {
  return (
    <View className="rounded-full px-3 py-1.5" style={{ backgroundColor: hexToRgba(color, 0.16) }}>
      <Text className="font-mono text-base text-textPrimary">{budgetDollars(amount)}</Text>
    </View>
  )
}

/**
 * A budget not set yet: a dashed outline of the chip it would become, holding what the category
 * usually costs — or just a plus when there's no history to suggest from.
 */
export function SuggestionChip({ amount, color }: { amount: number | null; color: string }) {
  return (
    <View
      className="flex-row items-center gap-1 rounded-full px-3 py-1.5"
      style={{ borderWidth: 1.5, borderStyle: 'dashed', borderColor: hexToRgba(color, 0.6) }}
    >
      <Ionicons name="add" size={14} color={colors.textPrimary} />
      {amount != null ? <Text className="font-mono text-base text-textPrimary">{budgetDollars(amount)}</Text> : null}
    </View>
  )
}
