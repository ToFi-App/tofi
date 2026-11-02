import { Pressable, View } from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import { SafeAreaView } from 'react-native-safe-area-context'
import { colors } from '@/constants/theme'
import { useAccounts } from '@/hooks/useAccounts'
import { MonthCalendar } from '@/components/home/MonthCalendar'
import { MonthNavigator } from '@/components/transactions/MonthNavigator'
import { AccountsFilterDropdown } from '@/components/ui/AccountsFilterDropdown'
import { useTransactionEditorActions } from '@/components/transactions/TransactionEditorProvider'
import { shiftMonth } from '@/lib/transactions/filterByMonth'
import { useSelectedMonth } from '@/hooks/useSelectedMonth'
import { useSelectedAccountFilter } from '@/hooks/useSelectedAccountFilter'

/**
 * The Calendar tab: the month day by day, every day shaded by what it spent, over the list of what
 * happened on each. Its month and account filter are Home's (useSelectedMonth,
 * useSelectedAccountFilter), so the two tabs always show the same month — and Home's calendar
 * preview opens this tab on it.
 */
export default function CalendarTab() {
  const [month, setMonth] = useSelectedMonth()
  const [selectedAccountId, setSelectedAccountId] = useSelectedAccountFilter()
  const accounts = useAccounts()
  const { openNewManual } = useTransactionEditorActions()

  const header = (
    <View className="flex-row items-center">
      <View className="flex-1 flex-row items-center gap-3">
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
