import { useState } from 'react'
import { SafeAreaView } from 'react-native-safe-area-context'
import { pageBackdrop } from '@/constants/theme'
import { useAccounts } from '@/hooks/useAccounts'
import { MonthCalendar } from '@/components/home/MonthCalendar'
import { HomeHeader } from '@/components/home/HomeHeader'
import { useCreateFlow } from '@/components/groups/useCreateFlow'
import { HeroSurfaceContext } from '@/components/ui/HeroGlass'
import { useSelectedMonth } from '@/hooks/useSelectedMonth'
import { useSelectedAccountFilter } from '@/hooks/useSelectedAccountFilter'
import { PageBackdrop } from '@/components/ui/PageBackdrop'
import { CalendarFilterButton } from '@/components/transactions/CalendarFilterButton'
import { useCalendarFilter } from '@/hooks/useCalendarFilter'
import { activeFilterCount } from '@/lib/transactions/calendarFilter'

/**
 * The Calendar tab: the month day by day, every day shaded by what it spent, over the list of what
 * happened on each. Its month and account filter are Home's (useSelectedMonth,
 * useSelectedAccountFilter), so the two tabs always show the same month — and its header is Home's
 * too (HomeHeader: the month pill centred, the account filter and "+" at the right), on the plain page
 * styling Home's Charts view uses. Calendar adds a filter of its own (useCalendarFilter, not shared
 * with Home): its button takes the header's left, which Calendar, having no view switch, leaves
 * free, so the account filter sits where it does on Home.
 *
 * Its "+" (useCreateFlow) is the app's one write button: New transaction or New group. Home has none.
 */
export default function CalendarTab() {
  const [month, setMonth] = useSelectedMonth()
  const [selectedAccountId, setSelectedAccountId] = useSelectedAccountFilter()
  const accounts = useAccounts()
  const [filter, setFilter] = useCalendarFilter()
  const [filterSheetOpen, setFilterSheetOpen] = useState(false)
  const create = useCreateFlow()

  const filterButton = <CalendarFilterButton activeCount={activeFilterCount(filter)} onPress={() => setFilterSheetOpen(true)} />
  // A function, so MonthCalendar can hand the month picker the months its filter matches.
  const renderHeader = (availableMonths?: Set<string>) => (
    <HeroSurfaceContext.Provider value="plain">
      <HomeHeader
        month={month}
        onMonthChange={setMonth}
        accounts={accounts.data ?? []}
        selectedAccountId={selectedAccountId}
        onAccountChange={setSelectedAccountId}
        {...create.headerProps}
        filterButton={filterButton}
        availableMonths={availableMonths}
      />
    </HeroSurfaceContext.Provider>
  )

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: pageBackdrop.stops[0] }} edges={['top']}>
      <PageBackdrop />
      <MonthCalendar
        month={month}
        selectedAccountId={selectedAccountId}
        onMonthChange={setMonth}
        renderHeader={renderHeader}
        filter={filter}
        onFilterChange={setFilter}
        filterSheetOpen={filterSheetOpen}
        onFilterSheetClose={() => setFilterSheetOpen(false)}
        filterButton={filterButton}
        onOpenGroup={create.openGroup}
      />
      {create.elements}
    </SafeAreaView>
  )
}
