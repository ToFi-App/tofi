import { ActivityIndicator, Pressable, Text } from 'react-native'
import { colors } from '@/constants/theme'
import { haptics } from '@/lib/ui/haptics'

interface ButtonProps {
  label: string
  onPress: () => void
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger'
  disabled?: boolean
  loading?: boolean
}

export function Button({ label, onPress, variant = 'primary', disabled, loading }: ButtonProps) {
  const isDisabled = disabled || loading

  const containerClass = {
    primary: 'bg-primary',
    secondary: 'bg-transparent border border-border',
    ghost: 'bg-transparent',
    danger: 'bg-expense',
  }[variant]

  const textClass = {
    primary: 'text-textInverse',
    secondary: 'text-textPrimary',
    ghost: 'text-primary',
    danger: 'text-textInverse',
  }[variant]

  return (
    <Pressable
      onPress={() => {
        haptics.tap()
        onPress()
      }}
      disabled={isDisabled}
      accessibilityRole="button"
      accessibilityState={{ disabled: isDisabled }}
      className={`h-[52px] flex-row items-center justify-center rounded-lg px-5 active:opacity-80 ${containerClass} ${
        isDisabled ? 'opacity-40' : ''
      }`}
    >
      {loading ? (
        <ActivityIndicator
          color={variant === 'primary' || variant === 'danger' ? colors.textInverse : colors.primary}
        />
      ) : (
        <Text className={`font-sansSemi text-base ${textClass}`}>{label}</Text>
      )}
    </Pressable>
  )
}
