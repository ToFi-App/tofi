import { Pressable, ScrollView, Text, View } from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import { SafeAreaView } from 'react-native-safe-area-context'
import { router, useLocalSearchParams } from 'expo-router'
import { colors } from '@/constants/theme'
import { useAmountsMasked } from '@/hooks/useAmountsMasked'
import { useInvestmentScope } from '@/hooks/useInvestmentScope'
import { HoldingDetail } from '@/components/accounts/HoldingDetail'
import { EmptyState } from '@/components/ui/EmptyState'

/**
 * One holding's page, pushed from the Investments screen. It reads the same investments that screen
 * had in view — one account, or all of them, a security held in several merged into one position —
 * so the page shows the position that was tapped.
 */
export default function HoldingScreen() {
  const { securityId, accountId } = useLocalSearchParams<{ securityId?: string; accountId?: string }>()
  const { holdings, investmentHistory } = useInvestmentScope(accountId || null)
  const { isMasked } = useAmountsMasked()
  const holding = securityId ? (holdings.find((h) => h.securityId === securityId) ?? null) : null

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }} edges={['top']}>
      <View className="flex-row items-center gap-2 px-5 pb-2 pt-3">
        <Pressable onPress={() => router.back()} hitSlop={10} accessibilityLabel="Back">
          <Ionicons name="chevron-back" size={24} color={colors.textPrimary} />
        </Pressable>
        <Text className="font-display text-lg text-textPrimary" numberOfLines={1}>
          {holding ? (holding.ticker ?? holding.name ?? '') : ''}
        </Text>
      </View>
      {holding ? (
        <ScrollView contentInsetAdjustmentBehavior="automatic" className="px-5" contentContainerClassName="pb-10">
          <HoldingDetail
            holding={holding}
            inputs={investmentHistory.inputs}
            earliest={investmentHistory.priceEarliest}
            today={investmentHistory.today}
            isMasked={isMasked}
          />
        </ScrollView>
      ) : (
        // Sold or unlinked since the row was tapped.
        <EmptyState message="This holding isn't in your accounts anymore." />
      )}
    </SafeAreaView>
  )
}
