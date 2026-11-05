import { useRef, useState } from 'react'
import { Pressable, Text, TextInput, View } from 'react-native'
import { colors } from '@/constants/theme'

interface AmountInputProps {
  value: string
  onChangeText: (text: string) => void
  placeholder: string
  accessibilityLabel: string
}

/**
 * A money amount entered as the headline it becomes: large, centered, in the display face the
 * budget's total uses. No box — an underline that shows only while typing is the only field
 * chrome — and the whole block focuses the input, so the target is the number, not a sliver of it.
 *
 * What's drawn is a plain Text, with the real input invisible behind it taking the keystrokes. A
 * visible TextInput sized itself to what was typed, so a value set from outside — the budget
 * sheet's stepper — kept the old width and clipped a digit; and DM Sans' digits differ in width,
 * so no width worked out from the digit count fit every number. Text always measures exactly.
 * Typing still only ever appends: the hidden field can't be tapped mid-number.
 */
export function AmountInput({ value, onChangeText, placeholder, accessibilityLabel }: AmountInputProps) {
  const inputRef = useRef<TextInput>(null)
  const [isFocused, setIsFocused] = useState(false)
  const ink = value ? colors.textPrimary : colors.textMuted

  return (
    <Pressable onPress={() => inputRef.current?.focus()} accessible={false} className="items-center gap-2">
      <View className="flex-row items-center justify-center">
        <Text className="font-display text-2xl" style={{ color: ink }}>
          $
        </Text>
        <Text className="px-0.5 font-display text-3xl" style={{ color: ink }}>
          {value || placeholder}
        </Text>
      </View>
      <View className="h-0.5 w-28 rounded-full" style={{ backgroundColor: isFocused ? colors.primary : 'transparent' }} />
      <TextInput
        ref={inputRef}
        value={value}
        onChangeText={onChangeText}
        onFocus={() => {
          setIsFocused(true)
          inputRef.current?.setSelection(value.length, value.length)
        }}
        onBlur={() => setIsFocused(false)}
        keyboardType="decimal-pad"
        accessibilityLabel={accessibilityLabel}
        textContentType="none"
        autoComplete="off"
        caretHidden
        style={{ position: 'absolute', width: 1, height: 1, opacity: 0 }}
      />
    </Pressable>
  )
}
