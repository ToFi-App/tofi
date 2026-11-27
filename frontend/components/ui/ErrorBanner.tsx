import { Ionicons } from '@expo/vector-icons'
import { useEffect } from 'react'
import { Pressable, Text, View } from 'react-native'
import { colors } from '@/constants/theme'
import { haptics } from '@/lib/ui/haptics'

interface ErrorBannerProps {
  message: string
  onDismiss?: () => void
}

// Inline error banner: rose background, dismiss button — not a modal (design.md).
export function ErrorBanner({ message, onDismiss }: ErrorBannerProps) {
  // A dismissible banner is an action that just failed (a save, a delete), so it lands with an error
  // buzz. One that can't be dismissed reports a screen that couldn't load, and stays silent — a
  // buzz every time that screen opens would only nag.
  const isActionError = onDismiss != null
  useEffect(() => {
    if (isActionError) haptics.error()
  }, [message, isActionError])

  return (
    <View className="flex-row items-start gap-3 rounded-md bg-expense/10 px-4 py-3">
      <Text className="font-sans text-base text-expense">{message}</Text>
      {onDismiss ? (
        <Pressable onPress={onDismiss} accessibilityLabel="Dismiss error" hitSlop={8} className="ml-auto">
          <Ionicons name="close" size={18} color={colors.expense} />
        </Pressable>
      ) : null}
    </View>
  )
}
