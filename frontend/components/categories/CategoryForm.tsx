import { useMemo, useState } from 'react'
import { Pressable, ScrollView, Text, View } from 'react-native'
import { categoryColors, colors } from '@/constants/theme'
import { TextField } from '@/components/ui/TextField'
import { Button } from '@/components/ui/Button'
import { IconPicker } from './IconPicker'
import { PlaidPfcPicker } from './PlaidPfcPicker'
import type { Category, PlaidCategoryMapping } from '@/types/domain'

interface CategoryFormProps {
  category?: Category
  mappings: PlaidCategoryMapping[]
  categories: Category[]
  isSaving: boolean
  onSave: (input: { name: string; color: string; icon: string; selectedCodes: Set<string> }) => void
  onDelete?: () => void
}

export function CategoryForm({ category, mappings, categories, isSaving, onSave, onDelete }: CategoryFormProps) {
  const [name, setName] = useState(category?.name ?? '')
  const [color, setColor] = useState(category?.color ?? Object.values(categoryColors)[0])
  const [icon, setIcon] = useState(category?.icon ?? '')

  const initialSelectedCodes = useMemo(() => {
    if (!category) return new Set<string>()
    return new Set(
      mappings.filter((m) => m.categoryId === category.id && m.plaidPfcDetailed).map((m) => m.plaidPfcDetailed as string),
    )
  }, [category, mappings])

  const [selectedCodes, setSelectedCodes] = useState<Set<string>>(initialSelectedCodes)

  const canSave = name.trim().length > 0 && icon.trim().length > 0

  return (
    <ScrollView className="flex-1 bg-background" contentContainerClassName="gap-6 px-5 py-6">
      <TextField label="Name" value={name} onChangeText={setName} placeholder="e.g. Groceries" />

      <View className="gap-2">
        <Text className="font-sansMed text-sm text-textSecondary">Icon</Text>
        <IconPicker selectedSlug={icon} color={color} onSelect={setIcon} />
      </View>

      <View className="gap-2">
        <Text className="font-sansMed text-sm text-textSecondary">Color</Text>
        <View className="flex-row flex-wrap gap-3">
          {Object.values(categoryColors).map((swatch) => (
            <Pressable
              key={swatch}
              onPress={() => setColor(swatch)}
              className="h-9 w-9 items-center justify-center rounded-full"
              style={{ backgroundColor: swatch, borderWidth: color === swatch ? 2 : 0, borderColor: colors.textPrimary }}
            />
          ))}
        </View>
      </View>

      <View className="gap-2">
        <Text className="font-sansMed text-sm text-textSecondary">
          Plaid categories for this category
        </Text>
        <PlaidPfcPicker
          mappings={mappings}
          categories={categories}
          currentCategoryId={category?.id ?? null}
          selectedCodes={selectedCodes}
          onChange={setSelectedCodes}
        />
      </View>

      <Button
        label={category ? 'Save Changes' : 'Create Category'}
        onPress={() => onSave({ name: name.trim(), color, icon: icon.trim(), selectedCodes })}
        disabled={!canSave}
        loading={isSaving}
      />

      {onDelete ? <Button label="Delete Category" variant="ghost" onPress={onDelete} /> : null}
    </ScrollView>
  )
}
