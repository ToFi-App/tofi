import { router, Stack } from 'expo-router'
import { Ionicons } from '@expo/vector-icons'
import { Pressable, ScrollView, Text, View } from 'react-native'
import { colors } from '@/constants/theme'
import { useCategories } from '@/hooks/useCategories'
import { ErrorBanner } from '@/components/ui/ErrorBanner'
import { CategoryIcon } from '@/components/categories/CategoryIcon'
import { SettingsGroup } from '@/components/settings/SettingsBlocks'
import { TabBarSpacer } from '@/components/navigation/FloatingTabs'

/**
 * Every category, one group card. The navigation bar names the screen and carries the add button, so
 * the page holds nothing but the list.
 */
export default function CategoriesListScreen() {
  const categories = useCategories()

  return (
    <ScrollView contentInsetAdjustmentBehavior="automatic" className="flex-1" contentContainerClassName="gap-4 px-5 py-4">
      <Stack.Screen
        options={{
          headerRight: () => (
            <Pressable onPress={() => router.push({ pathname: '/(tabs)/settings/category-form' })} hitSlop={8} accessibilityLabel="Add category">
              <Ionicons name="add" size={26} color={colors.primary} />
            </Pressable>
          ),
        }}
      />

      {categories.error ? <ErrorBanner message="Could not load categories." /> : null}

      <SettingsGroup>
        {(categories.data ?? []).map((category) => (
          <Pressable
            key={category.id}
            onPress={() => router.push({ pathname: '/(tabs)/settings/category-form', params: { id: category.id } })}
            accessibilityRole="button"
            className="flex-row items-center gap-3 px-4 py-3 active:bg-surfaceRaised"
          >
            <View className="h-8 w-8 items-center justify-center rounded-full" style={{ backgroundColor: `${category.color}30` }}>
              <CategoryIcon icon={category.icon} size={16} color={category.color} />
            </View>
            <Text className="flex-1 font-sansMed text-base text-textPrimary">{category.name}</Text>
            <Ionicons name="chevron-forward" size={18} color={colors.textSecondary} />
          </Pressable>
        ))}
      </SettingsGroup>
      <TabBarSpacer />
    </ScrollView>
  )
}
