import { useState } from 'react'
import { router, useLocalSearchParams } from 'expo-router'
import { Alert, View } from 'react-native'
import { useCategories } from '@/hooks/useCategories'
import { usePlaidCategoryMappings } from '@/hooks/usePlaidCategoryMappings'
import { CategoryDetails } from '@/components/categories/CategoryDetails'
import { CategoryForm } from '@/components/categories/CategoryForm'
import { ErrorBanner } from '@/components/ui/ErrorBanner'
import { LoadingScreen } from '@/components/ui/LoadingScreen'
import { PFC_TAXONOMY } from '@/constants/plaid'

function primaryForCode(detailedCode: string): string {
  const group = PFC_TAXONOMY.find((g) => g.detailedCodes.includes(detailedCode))
  if (!group) throw new Error(`Unknown PFC code: ${detailedCode}`)
  return group.primary
}

export default function CategoryFormScreen() {
  const { id } = useLocalSearchParams<{ id?: string }>()
  const [error, setError] = useState<string | null>(null)
  const categories = useCategories()
  const mappings = usePlaidCategoryMappings()

  const category = id ? categories.data?.find((c) => c.id === id) : undefined

  async function handleSave(input: { name: string; color: string; icon: string; selectedCodes: Set<string> }) {
    setError(null)
    try {
      const savedCategory = category
        ? await categories.update({ id: category.id, name: input.name, color: input.color, icon: input.icon })
        : await categories.create({ name: input.name, color: input.color, icon: input.icon })

      const existingCodes = new Set(
        (mappings.data ?? [])
          .filter((m) => m.categoryId === savedCategory.id && m.plaidPfcDetailed)
          .map((m) => m.plaidPfcDetailed as string),
      )

      for (const code of input.selectedCodes) {
        if (!existingCodes.has(code)) {
          await mappings.create({ plaidPfcPrimary: primaryForCode(code), plaidPfcDetailed: code, categoryId: savedCategory.id })
        }
      }
      for (const existingMapping of mappings.data ?? []) {
        if (
          existingMapping.categoryId === savedCategory.id &&
          existingMapping.plaidPfcDetailed &&
          !input.selectedCodes.has(existingMapping.plaidPfcDetailed)
        ) {
          await mappings.delete({ id: existingMapping.id })
        }
      }

      router.back()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save this category.')
    }
  }

  function handleDelete() {
    if (!category) return
    Alert.alert(
      `Delete "${category.name}"?`,
      'Transactions using this category will become uncategorized. This cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            setError(null)
            try {
              await categories.delete({ id: category.id })
              router.back()
            } catch (err) {
              setError(err instanceof Error ? err.message : 'Could not delete this category.')
            }
          },
        },
      ],
    )
  }

  // CategoryForm seeds its name/color/icon/selectedCodes state from props with once-only
  // useState initializers, so it must never mount before both queries have resolved —
  // otherwise an edit would open with empty PFC codes and Save would wipe real mappings.
  if (categories.isLoading || mappings.isLoading) return <LoadingScreen />

  // Built-in categories are fixed, so they get a read-only screen rather than a form whose Save
  // and Delete the server would reject anyway.
  if (category?.isDefault) {
    return (
      <View style={{ flex: 1 }}>
        <CategoryDetails category={category} mappings={mappings.data ?? []} />
      </View>
    )
  }

  return (
    <View style={{ flex: 1 }}>
      <View className="px-5 pt-2">{error ? <ErrorBanner message={error} onDismiss={() => setError(null)} /> : null}</View>
      <CategoryForm
        category={category}
        mappings={mappings.data ?? []}
        isSaving={false}
        onSave={handleSave}
        onDelete={category ? handleDelete : undefined}
      />
    </View>
  )
}
