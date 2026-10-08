import { ScrollView, Text, View } from 'react-native'
import { hexToRgba } from '@/constants/theme'
import { pfcLabel } from '@/constants/plaid'
import { CategoryIcon } from './CategoryIcon'
import type { Category, PlaidCategoryMapping } from '@/types/domain'

interface CategoryDetailsProps {
  category: Category
  mappings: PlaidCategoryMapping[]
}

/**
 * Read-only view of a built-in category. Defaults are fixed — name, colour, icon and Plaid codes
 * alike — so the edit form would be a screen of disabled inputs; this shows the same information
 * without implying any of it is editable.
 */
export function CategoryDetails({ category, mappings }: CategoryDetailsProps) {
  const codes = mappings
    .filter((m) => m.categoryId === category.id && m.plaidPfcDetailed)
    .map((m) => ({ id: m.id, label: pfcLabel(m.plaidPfcDetailed as string, m.plaidPfcPrimary) }))
    .sort((a, b) => a.label.localeCompare(b.label))

  return (
    <ScrollView contentInsetAdjustmentBehavior="automatic" className="flex-1 bg-background" contentContainerClassName="gap-6 px-5 py-6">
      <View className="items-center gap-3 rounded-xl bg-surface p-6">
        <View
          className="h-16 w-16 items-center justify-center rounded-full"
          style={{ backgroundColor: hexToRgba(category.color, 0.18) }}
        >
          <CategoryIcon icon={category.icon} size={32} color={category.color} />
        </View>
        <Text className="font-sansSemi text-lg text-textPrimary">{category.name}</Text>
        <Text className="text-center font-sans text-sm text-textMuted">
          This is a built-in category, so it can&apos;t be edited or deleted. Create your own category to
          organise spending differently.
        </Text>
      </View>

      <View className="gap-2">
        <Text className="font-sansMed text-sm text-textSecondary">Plaid categories routed here</Text>
        <View className="gap-1 rounded-md bg-surface px-4 py-3">
          {codes.length > 0 ? (
            codes.map((code) => (
              <Text key={code.id} className="font-sans text-base text-textPrimary">
                {code.label}
              </Text>
            ))
          ) : (
            <Text className="font-sans text-base text-textMuted">None</Text>
          )}
        </View>
      </View>
    </ScrollView>
  )
}
