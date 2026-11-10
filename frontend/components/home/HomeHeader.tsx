import type { ReactNode } from 'react'
import { View } from 'react-native'
import { SquarePen } from 'lucide-react-native'
import { MonthNavigator } from '@/components/transactions/MonthNavigator'
import { AccountsFilterDropdown } from '@/components/ui/AccountsFilterDropdown'
import { GlassButton } from '@/components/ui/GlassButton'
import { useHeroInk } from '@/components/ui/HeroGlass'
import { shiftMonth, type YearMonth } from '@/lib/transactions/filterByMonth'
import type { Account } from '@/types/domain'

interface HomeHeaderProps {
  month: YearMonth
  onMonthChange: (month: YearMonth) => void
  accounts: Account[]
  selectedAccountId: string | null
  onAccountChange: (accountId: string | null) => void
  onWrite: () => void
  /** The screen's own control, at the left of the row — Home's Summary/Charts switch. */
  leading?: ReactNode
}

/**
 * The top row of Home's Summary, on its mint top section: the screen's own control at the left
 * (`leading`, the Summary/Charts switch), the month as a pill in the centre, and the account filter
 * and write button together at the right, where the thumb reaches. All glass, all the same height.
 *
 * The pill is centred on the row itself rather than between its neighbours, which are of different
 * widths: it sits on the same centre line as the figure under it.
 */
export function HomeHeader({ month, onMonthChange, accounts, selectedAccountId, onAccountChange, onWrite, leading }: HomeHeaderProps) {
  const ink = useHeroInk()
  return (
    <View className="flex-row items-center justify-between">
      {leading ?? <View />}
      <View pointerEvents="box-none" className="absolute bottom-0 left-0 right-0 top-0 items-center justify-center">
        <MonthNavigator
          variant="pill"
          month={month}
          onPrevious={() => onMonthChange(shiftMonth(month, -1))}
          onNext={() => onMonthChange(shiftMonth(month, 1))}
          onSelect={onMonthChange}
        />
      </View>
      <View className="flex-row items-center gap-2">
        <AccountsFilterDropdown variant="glass" accounts={accounts} selectedAccountId={selectedAccountId} onSelect={onAccountChange} />
        <GlassButton onPress={onWrite} accessibilityLabel="Write a transaction">
          <SquarePen size={18} strokeWidth={2} color={ink} />
        </GlassButton>
      </View>
    </View>
  )
}
