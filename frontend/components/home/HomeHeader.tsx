import { View } from 'react-native'
import { SquarePen } from 'lucide-react-native'
import { heroGradient } from '@/constants/theme'
import { MonthNavigator } from '@/components/transactions/MonthNavigator'
import { AccountsFilterDropdown } from '@/components/ui/AccountsFilterDropdown'
import { GlassButton } from '@/components/ui/GlassButton'
import { shiftMonth, type YearMonth } from '@/lib/transactions/filterByMonth'
import type { Account } from '@/types/domain'

interface HomeHeaderProps {
  month: YearMonth
  onMonthChange: (month: YearMonth) => void
  accounts: Account[]
  selectedAccountId: string | null
  onAccountChange: (accountId: string | null) => void
  onWrite: () => void
}

/**
 * The top row of Home's Summary, on its mint top section: three quiet controls and nothing else — the
 * account filter at the left, the month as a pill in the centre, the write button at the right
 * where the thumb reaches. The Summary/Charts switch lives on the sheet, beside the categories it
 * swaps, so this row stays free of it.
 */
export function HomeHeader({ month, onMonthChange, accounts, selectedAccountId, onAccountChange, onWrite }: HomeHeaderProps) {
  return (
    <View className="flex-row items-center justify-between">
      <AccountsFilterDropdown variant="glass" accounts={accounts} selectedAccountId={selectedAccountId} onSelect={onAccountChange} />
      <MonthNavigator
        variant="pill"
        month={month}
        onPrevious={() => onMonthChange(shiftMonth(month, -1))}
        onNext={() => onMonthChange(shiftMonth(month, 1))}
        onSelect={onMonthChange}
      />
      <GlassButton onPress={onWrite} accessibilityLabel="Write a transaction">
        <SquarePen size={18} strokeWidth={2} color={heroGradient.ink} />
      </GlassButton>
    </View>
  )
}
