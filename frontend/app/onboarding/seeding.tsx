import { Ionicons } from '@expo/vector-icons'
import { router } from 'expo-router'
import { useEffect, useRef, useState } from 'react'
import { ActivityIndicator, Text, View } from 'react-native'
import { useOnboarding } from '@/hooks/useOnboarding'
import { onboardingBackTarget } from '@/lib/onboarding/backTarget'
import { OnboardingStepHeader } from '@/components/onboarding/OnboardingStepHeader'
import { Button } from '@/components/ui/Button'
import { ErrorBanner } from '@/components/ui/ErrorBanner'
import { colors } from '@/constants/theme'
import { haptics } from '@/lib/ui/haptics'

type StepKey = 'categories' | 'transactions' | 'mappings'

const STEPS: Array<{ key: StepKey; label: string }> = [
  { key: 'categories', label: 'Setting up your categories' },
  { key: 'transactions', label: 'Fetching recent transactions' },
  { key: 'mappings', label: 'Auto-categorizing your spending' },
]

export default function SeedingScreen() {
  const { seedCategories, syncTransactions, generateVendorMappings } = useOnboarding()
  const [completed, setCompleted] = useState<Set<StepKey>>(new Set())
  const [error, setError] = useState<string | null>(null)
  const hasStarted = useRef(false)
  const backTarget = onboardingBackTarget(3, { seedingFailed: error !== null })

  async function runSequence() {
    setError(null)
    try {
      await seedCategories()
      setCompleted((prev) => new Set(prev).add('categories'))

      const synced = await syncTransactions()
      setCompleted((prev) => new Set(prev).add('transactions'))

      await generateVendorMappings({
        transactions: synced.added.map((transaction: any) => ({
          merchant_name: transaction.merchant_name ?? null,
          personal_finance_category: transaction.personal_finance_category,
        })),
      })
      setCompleted((prev) => new Set(prev).add('mappings'))

      haptics.success()
      router.replace('/(tabs)')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong setting up your account.')
    }
  }

  useEffect(() => {
    if (hasStarted.current) return
    hasStarted.current = true
    runSequence()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <View className="flex-1 bg-background">
      <OnboardingStepHeader
        step={3}
        onBack={backTarget ? () => router.replace(backTarget) : undefined}
      />
      <View className="flex-1 justify-center gap-8 px-5">
        <View className="gap-2">
          <Text className="font-sansSemi text-xl text-textPrimary">Almost there</Text>
          <Text className="font-sans text-base text-textSecondary">
            Getting everything ready — this only takes a moment.
          </Text>
        </View>

        <View className="gap-4">
          {STEPS.map((step) => {
            const isDone = completed.has(step.key)
            const isActive = !isDone && !error && completed.size === STEPS.indexOf(step)
            return (
              <View key={step.key} className="flex-row items-center gap-3">
                {isDone ? (
                  <Ionicons name="checkmark-circle" size={20} color={colors.income} />
                ) : isActive ? (
                  <ActivityIndicator size="small" color={colors.primary} />
                ) : (
                  <View className="h-5 w-5 rounded-full border border-border" />
                )}
                <Text
                  className={`font-sans text-base ${isDone ? 'text-textPrimary' : 'text-textSecondary'}`}
                >
                  {step.label}
                </Text>
              </View>
            )
          })}
        </View>

        {error ? (
          <View className="gap-4">
            <ErrorBanner message={error} />
            <Button label="Try Again" onPress={runSequence} />
          </View>
        ) : null}
      </View>
    </View>
  )
}
