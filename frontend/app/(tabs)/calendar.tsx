import { useState } from 'react'
import { SafeAreaView } from 'react-native-safe-area-context'
import { pageBackdrop } from '@/constants/theme'
import { useAccounts } from '@/hooks/useAccounts'
import { MonthCalendar } from '@/components/home/MonthCalendar'
import { HomeHeader, type WriteAnchor } from '@/components/home/HomeHeader'
import { CreateMenu } from '@/components/groups/CreateMenu'
import { GroupSheet } from '@/components/groups/GroupSheet'
import { NewGroupSheet } from '@/components/groups/NewGroupSheet'
import { useGroupsMenuSeen } from '@/hooks/useGroupsMenuSeen'
import { HeroSurfaceContext } from '@/components/ui/HeroGlass'
import { useTransactionEditorActions } from '@/components/transactions/TransactionEditorProvider'
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
 * too (HomeHeader: the month pill centred, the filter and pen at the right), on the plain page
 * styling Home's Charts view uses. Calendar adds a filter of its own (useCalendarFilter, not shared
 * with Home): its button takes the header's left, which Calendar, having no view switch, leaves
 * free, so the account filter and pen sit where they do on Home.
 *
 * Its write button is a "+" instead of Home's pen: it opens a small menu, New transaction or New
 * group (docs/transaction-groups.md §4). Until that menu has been opened once the button carries a
 * dot, which is how people find groups; opening it clears the dot for good.
 */
export default function CalendarTab() {
  const [month, setMonth] = useSelectedMonth()
  const [selectedAccountId, setSelectedAccountId] = useSelectedAccountFilter()
  const accounts = useAccounts()
  const { openNewManual } = useTransactionEditorActions()
  const [filter, setFilter] = useCalendarFilter()
  const [filterSheetOpen, setFilterSheetOpen] = useState(false)
  const [menuAnchor, setMenuAnchor] = useState<WriteAnchor | null>(null)
  const [newGroupOpen, setNewGroupOpen] = useState(false)
  const [openGroupId, setOpenGroupId] = useState<string | null>(null)
  const menuSeen = useGroupsMenuSeen()
  // Captured at open, because opening is also what marks the menu seen: read live, the NEW tag
  // would vanish in the same render that showed it.
  const [menuShowsNew, setMenuShowsNew] = useState(false)

  const openMenu = (anchor: WriteAnchor) => {
    setMenuShowsNew(!menuSeen.seen)
    setMenuAnchor(anchor)
    if (!menuSeen.seen) menuSeen.markSeen()
  }

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
        onWrite={openMenu}
        writeVariant="plus"
        writeDot={!menuSeen.seen}
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
        onOpenGroup={setOpenGroupId}
      />
      <CreateMenu
        anchor={menuAnchor}
        // The NEW tag shows on the same opening that clears the dot, then never again.
        showNewBadge={menuShowsNew}
        onClose={() => setMenuAnchor(null)}
        onNewTransaction={() => {
          setMenuAnchor(null)
          openNewManual()
        }}
        onNewGroup={() => {
          setMenuAnchor(null)
          setNewGroupOpen(true)
        }}
      />
      <NewGroupSheet
        visible={newGroupOpen}
        onClose={() => setNewGroupOpen(false)}
        onCreated={(groupId) => {
          setNewGroupOpen(false)
          setOpenGroupId(groupId)
        }}
      />
      <GroupSheet groupId={openGroupId} onClose={() => setOpenGroupId(null)} />
    </SafeAreaView>
  )
}
