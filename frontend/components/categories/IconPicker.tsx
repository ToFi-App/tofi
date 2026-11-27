import { Pressable, View } from 'react-native'
import { colors, hexToRgba } from '@/constants/theme'
import { SELECTABLE_ICON_SLUGS } from '@/lib/categories/icons'
import { CategoryIcon } from './CategoryIcon'
import { haptics } from '@/lib/ui/haptics'

interface IconPickerProps {
  selectedSlug: string
  /** Tints the swatches so the icon is previewed in the color the category will actually use. */
  color: string
  onSelect: (slug: string) => void
}

export function IconPicker({ selectedSlug, color, onSelect }: IconPickerProps) {
  return (
    <View className="flex-row flex-wrap gap-3">
      {SELECTABLE_ICON_SLUGS.map((slug) => {
        const isSelected = slug === selectedSlug
        return (
          <Pressable
            key={slug}
            onPress={() => {
              if (!isSelected) haptics.select()
              onSelect(slug)
            }}
            accessibilityRole="button"
            accessibilityLabel={slug}
            accessibilityState={{ selected: isSelected }}
            className="h-11 w-11 items-center justify-center rounded-full"
            style={{
              backgroundColor: hexToRgba(color, isSelected ? 0.28 : 0.12),
              borderWidth: isSelected ? 2 : 0,
              borderColor: colors.textPrimary,
            }}
          >
            <CategoryIcon icon={slug} size={22} color={color} />
          </Pressable>
        )
      })}
    </View>
  )
}
