import { SafeAreaView } from 'react-native-safe-area-context'
import { colors } from '@/constants/theme'
import { useAccounts } from '@/hooks/useAccounts'
import { MonthCalendar } from '@/components/home/MonthCalendar'
import { MonthHeader } from '@/components/home/MonthHeader'
import { useTransactionEditorActions } from '@/components/transactions/TransactionEditorProvider'
import { useSelectedMonth } from '@/hooks/useSelectedMonth'
import { useSelectedAccountFilter } from '@/hooks/useSelectedAccountFilter'

/**
 * The Calendar tab: the month day by day, every day shaded by what it spent, over the list of what
 * happened on each. Its month and account filter are Home's (useSelectedMonth,
 * useSelectedAccountFilter), so the two tabs always show the same month — and its header is Home's
 * too (MonthHeader), so moving between them nothing in the header jumps.
 */
export default function CalendarTab() {
  const [month, setMonth] = useSelectedMonth()
  const [selectedAccountId, setSelectedAccountId] = useSelectedAccountFilter()
  const accounts = useAccounts()
  const { openNewManual } = useTransactionEditorActions()

  const header = (
    <MonthHeader
      month={month}
      onMonthChange={setMonth}
      accounts={accounts.data ?? []}
      selectedAccountId={selectedAccountId}
      onAccountChange={setSelectedAccountId}
      onWrite={openNewManual}
    />
  )

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }} edges={['top']}>
      <MonthCalendar month={month} selectedAccountId={selectedAccountId} header={header} />
    </SafeAreaView>
  )
}
