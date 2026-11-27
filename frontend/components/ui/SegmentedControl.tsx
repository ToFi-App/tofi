import { Pressable, Text, View } from 'react-native'
import { haptics } from '@/lib/ui/haptics'

interface SegmentedControlProps<T extends string> {
  options: Array<{ label: string; value: T }>
  // null renders with nothing selected, for choices that must be made explicitly
  // rather than defaulted into.
  value: T | null
  onChange: (value: T) => void
}

export function SegmentedControl<T extends string>({ options, value, onChange }: SegmentedControlProps<T>) {
  return (
    <View className="flex-row gap-2">
      {options.map((option) => {
        const isSelected = option.value === value
        return (
          <Pressable
            key={option.value}
            onPress={() => {
              if (option.value === value) return
              haptics.select()
              onChange(option.value)
            }}
            accessibilityRole="button"
            accessibilityState={{ selected: isSelected }}
            className={`h-11 flex-1 items-center justify-center rounded-md border ${
              isSelected ? 'border-primary bg-primaryMuted' : 'border-border bg-transparent'
            }`}
          >
            <Text className={`font-sansMed text-base ${isSelected ? 'text-primary' : 'text-textSecondary'}`}>
              {option.label}
            </Text>
          </Pressable>
        )
      })}
    </View>
  )
}
