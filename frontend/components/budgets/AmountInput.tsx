import { useRef, useState } from 'react'
import { Pressable, Text, TextInput, View } from 'react-native'
import { colors, fontFamily, fontSize } from '@/constants/theme'

interface AmountInputProps {
  value: string
  onChangeText: (text: string) => void
  placeholder: string
  accessibilityLabel: string
}

/**
 * A money amount entered as the headline it becomes: large, centered, in the display face the
 * budget ring uses for what's left. No box — an underline that turns teal while typing is the only
 * field chrome — and the whole block focuses the input, so the target is the number, not a sliver
 * of it.
 *
 * The cursor goes to the end on focus. iOS places it where the tap landed, and on a number this
 * large a tap on its left half put it before the first digit, so typing turned 515 into 0515.
 */
export function AmountInput({ value, onChangeText, placeholder, accessibilityLabel }: AmountInputProps) {
  const inputRef = useRef<TextInput>(null)
  const [isFocused, setIsFocused] = useState(false)

  return (
    <Pressable onPress={() => inputRef.current?.focus()} accessible={false} className="items-center gap-2">
      <View className="flex-row items-center justify-center">
        <Text className="font-display text-xl" style={{ color: value ? colors.textPrimary : colors.textMuted }}>
          $
        </Text>
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
          placeholder={placeholder}
          placeholderTextColor={colors.textMuted}
          accessibilityLabel={accessibilityLabel}
          textContentType="none"
          autoComplete="off"
          style={{
            minWidth: 48,
            paddingVertical: 0,
            paddingHorizontal: 2,
            fontFamily: fontFamily.display,
            fontSize: fontSize['2xl'],
            color: colors.textPrimary,
            textAlign: 'center',
          }}
        />
      </View>
      <View className="h-0.5 w-28 rounded-full" style={{ backgroundColor: isFocused ? colors.primary : colors.border }} />
    </Pressable>
  )
}
