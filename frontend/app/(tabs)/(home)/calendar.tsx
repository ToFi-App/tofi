import { useCallback, useState } from 'react'
import { Pressable, View } from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import { SafeAreaView } from 'react-native-safe-area-context'
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router'
import { colors } from '@/constants/theme'
import { useAccounts } from '@/hooks/useAccounts'
import { MonthCalendar } from '@/components/home/MonthCalendar'
import { MonthNavigator } from '@/components/transactions/MonthNavigator'
import { AccountsFilterDropdown } from '@/components/ui/AccountsFilterDropdown'
import { useTransactionEditorActions } from '@/components/transactions/TransactionEditorProvider'
import { monthFromParams, shiftMonth, type YearMonth } from '@/lib/transactions/filterByMonth'

/**
 * The month day by day, opened from the daily chart on Home's overview card: every day shaded by
 * what it spent, over the list of what happened on each. Starts on the month and account Home was
 * showing.
 */
export default function CalendarScreen() {
  const params = useLocalSearchParams<{ year?: string; month?: string; accountId?: string }>()
  const [month, setMonth] = useState<YearMonth>(() => monthFromParams(params))
  const [selectedAccountId, setSelectedAccountId] = useState<string | null>(params.accountId || null)
  useFocusEffect(
    useCallback(() => {
      setMonth(monthFromParams({ year: params.year, month: params.month }))
      setSelectedAccountId(params.accountId || null)
    }, [params.year, params.month, params.accountId]),
  )
  const accounts = useAccounts()
  const { openNewManual } = useTransactionEditorActions()

  const header = (
    <View className="flex-row items-center">
      <View className="flex-1 flex-row items-center gap-3">
        <Pressable onPress={() => router.back()} hitSlop={10} accessibilityLabel="Back">
          <Ionicons name="chevron-back" size={24} color={colors.textPrimary} />
        </Pressable>
        <AccountsFilterDropdown accounts={accounts.data ?? []} selectedAccountId={selectedAccountId} onSelect={setSelectedAccountId} />
      </View>
      <MonthNavigator month={month} onPrevious={() => setMonth(shiftMonth(month, -1))} onNext={() => setMonth(shiftMonth(month, 1))} onSelect={setMonth} />
      <View className="flex-1 items-end">
        <Pressable onPress={openNewManual} hitSlop={10} accessibilityLabel="Write a transaction">
          <Ionicons name="create-outline" size={24} color={colors.textPrimary} />
        </Pressable>
      </View>
    </View>
  )

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }} edges={['top']}>
      <MonthCalendar month={month} selectedAccountId={selectedAccountId} header={header} />
    </SafeAreaView>
  )
}
