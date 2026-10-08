import { router } from 'expo-router'
import { Ionicons } from '@expo/vector-icons'
import { Pressable, ScrollView, Text, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { colors } from '@/constants/theme'
import { useCategories } from '@/hooks/useCategories'
import { ErrorBanner } from '@/components/ui/ErrorBanner'
import { CategoryIcon } from '@/components/categories/CategoryIcon'

export default function CategoriesListScreen() {
  const categories = useCategories()

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }} edges={['top']}>
      <ScrollView contentInsetAdjustmentBehavior="automatic" contentContainerClassName="gap-4 px-5 py-4">
        <View className="flex-row items-center justify-between">
          <Text className="font-sansSemi text-lg text-textPrimary">Categories</Text>
          <Pressable onPress={() => router.push({ pathname: '/(tabs)/settings/category-form' })} accessibilityLabel="Add category">
            <Ionicons name="add-circle" size={26} color={colors.primary} />
          </Pressable>
        </View>

        {categories.error ? <ErrorBanner message="Could not load categories." /> : null}

        <View className="gap-1 rounded-md bg-surface">
          {(categories.data ?? []).map((category) => (
            <Pressable
              key={category.id}
              onPress={() => router.push({ pathname: '/(tabs)/settings/category-form', params: { id: category.id } })}
              className="flex-row items-center gap-3 px-4 py-4"
            >
              <View className="h-8 w-8 items-center justify-center rounded-full" style={{ backgroundColor: `${category.color}30` }}>
                <CategoryIcon icon={category.icon} size={16} color={category.color} />
              </View>
              <Text className="font-sansMed text-base text-textPrimary">{category.name}</Text>
              <View className="ml-auto">
                <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
              </View>
            </Pressable>
          ))}
        </View>
      </ScrollView>
    </SafeAreaView>
  )
}
