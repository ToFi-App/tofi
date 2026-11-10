import { SafeAreaView } from 'react-native-safe-area-context'
import { pageBackdrop } from '@/constants/theme'
import { useAccounts } from '@/hooks/useAccounts'
import { MonthCalendar } from '@/components/home/MonthCalendar'
import { HomeHeader } from '@/components/home/HomeHeader'
import { HeroSurfaceContext } from '@/components/ui/HeroGlass'
import { useTransactionEditorActions } from '@/components/transactions/TransactionEditorProvider'
import { useSelectedMonth } from '@/hooks/useSelectedMonth'
import { useSelectedAccountFilter } from '@/hooks/useSelectedAccountFilter'
import { PageBackdrop } from '@/components/ui/PageBackdrop'

/**
 * The Calendar tab: the month day by day, every day shaded by what it spent, over the list of what
 * happened on each. Its month and account filter are Home's (useSelectedMonth,
 * useSelectedAccountFilter), so the two tabs always show the same month — and its header is Home's
 * too (HomeHeader: the month pill centred, the filter and pen at the right), on the plain page
 * styling Home's Charts view uses, so moving between them nothing in the header jumps. Calendar has
 * no view switch of its own, so the header's left is empty.
 */
export default function CalendarTab() {
  const [month, setMonth] = useSelectedMonth()
  const [selectedAccountId, setSelectedAccountId] = useSelectedAccountFilter()
  const accounts = useAccounts()
  const { openNewManual } = useTransactionEditorActions()

  const header = (
    <HeroSurfaceContext.Provider value="plain">
      <HomeHeader
        month={month}
        onMonthChange={setMonth}
        accounts={accounts.data ?? []}
        selectedAccountId={selectedAccountId}
        onAccountChange={setSelectedAccountId}
        onWrite={openNewManual}
      />
    </HeroSurfaceContext.Provider>
  )

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: pageBackdrop.stops[0] }} edges={['top']}>
      <PageBackdrop />
      <MonthCalendar month={month} selectedAccountId={selectedAccountId} header={header} />
    </SafeAreaView>
  )
}
