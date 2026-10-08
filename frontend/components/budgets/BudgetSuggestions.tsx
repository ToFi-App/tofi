import { Pressable, ScrollView, Text, View } from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import { colors, hexToRgba, spacing } from '@/constants/theme'
import { CategoryIcon } from '@/components/categories/CategoryIcon'
import type { Category } from '@/types/domain'
import { Eyebrow } from './Eyebrow'

interface BudgetSuggestionsProps {
  items: Array<{ category: Category; typical: number }>
  onSelect: (categoryId: string) => void
}

/**
 * Categories worth a budget — ones with real spending and none set yet — as a row of Home's pastel
 * category cards, each carrying what a typical month costs. Tapping one opens the budget sheet,
 * which offers that typical amount.
 */
export function BudgetSuggestions({ items, onSelect }: BudgetSuggestionsProps) {
  return (
    <View className="gap-3">
      <View className="gap-0.5">
        <Eyebrow>Suggested budgets</Eyebrow>
        <Text className="font-sans text-xs text-textMuted">From what you usually spend</Text>
      </View>
      {/* Bleeds to the screen edges so cards scroll in from off-screen, with the page's own inset
          kept as the scroll padding. */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={{ marginHorizontal: -spacing[5] }}
        contentContainerStyle={{ gap: 10, paddingHorizontal: spacing[5] }}
      >
        {items.map(({ category, typical }) => (
          <Pressable
            key={category.id}
            onPress={() => onSelect(category.id)}
            accessibilityRole="button"
            accessibilityLabel={`Set a budget for ${category.name}`}
            className="w-36 gap-2 rounded-xl p-3"
            style={{ backgroundColor: hexToRgba(category.color, 0.16) }}
          >
            <View className="flex-row items-start justify-between">
              <View
                className="h-10 w-10 items-center justify-center rounded-full"
                style={{ backgroundColor: hexToRgba(category.color, 0.28) }}
              >
                <CategoryIcon icon={category.icon} size={18} color={category.color} />
              </View>
              <Ionicons name="add" size={20} color={colors.textSecondary} />
            </View>
            <View className="gap-0.5">
              <Text className="font-sansSemi text-sm text-textPrimary" numberOfLines={1}>
                {category.name}
              </Text>
              {/* Whole dollars: the typical month is already rounded to the nearest $5. */}
              <Text className="font-mono text-xs text-textSecondary">~${Math.round(typical).toLocaleString('en-US')}/mo</Text>
            </View>
          </Pressable>
        ))}
      </ScrollView>
    </View>
  )
}
