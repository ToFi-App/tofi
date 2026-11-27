import { useRef, type ReactNode } from 'react'
import { View } from 'react-native'
import { Plus, SquarePen } from 'lucide-react-native'
import { colors } from '@/constants/theme'
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
  /**
   * The write button. Handed the button's frame in window coordinates, so a caller that opens a
   * menu (Calendar's "+": New transaction / New group) can anchor it; Home just opens the editor.
   */
  onWrite: (anchor: WriteAnchor) => void
  /** Calendar's variant: a "+" that opens a create menu, rather than Home's pen. */
  writeVariant?: 'pen' | 'plus'
  /** A small dot on the write button: there's something new behind it the user hasn't opened yet. */
  writeDot?: boolean
  /** The screen's own control, at the left of the row — Home's Summary/Charts switch. */
  leading?: ReactNode
  /**
   * A filter button for the left of the row — the Calendar's, which has no `leading` of its own.
   * Three buttons don't fit right of the centred month pill on a narrow phone, so it takes the
   * free left side and the account filter and write button keep their places.
   */
  filterButton?: ReactNode
  /** Months the month picker lets you pick; see MonthNavigator. All of them when absent. */
  availableMonths?: Set<string>
}

export interface WriteAnchor {
  x: number
  y: number
  width: number
  height: number
}

/**
 * The top row of Home's Summary, on its mint top section: the screen's own control at the left
 * (`leading`, the Summary/Charts switch), the month as a pill in the centre, and the account filter
 * and write button together at the right, where the thumb reaches. All glass, all the same height.
 *
 * The pill is centred on the row itself rather than between its neighbours, which are of different
 * widths: it sits on the same centre line as the figure under it.
 */
export function HomeHeader({
  month,
  onMonthChange,
  accounts,
  selectedAccountId,
  onAccountChange,
  onWrite,
  writeVariant = 'pen',
  writeDot = false,
  leading,
  filterButton,
  availableMonths,
}: HomeHeaderProps) {
  const ink = useHeroInk()
  // Measured on press rather than on layout: the header scrolls with the page, so only the
  // position at the moment of the tap says where a menu should open.
  const writeRef = useRef<View>(null)
  const handleWrite = () => {
    const node = writeRef.current
    if (!node) return onWrite({ x: 0, y: 0, width: 0, height: 0 })
    node.measureInWindow((x, y, width, height) => onWrite({ x, y, width, height }))
  }
  const accountFilter = (
    <AccountsFilterDropdown variant="glass" accounts={accounts} selectedAccountId={selectedAccountId} onSelect={onAccountChange} />
  )
  return (
    <View className="flex-row items-center justify-between">
      {leading ?? filterButton ?? <View />}
      <View pointerEvents="box-none" className="absolute bottom-0 left-0 right-0 top-0 items-center justify-center">
        <MonthNavigator
          variant="pill"
          month={month}
          onPrevious={() => onMonthChange(shiftMonth(month, -1))}
          onNext={() => onMonthChange(shiftMonth(month, 1))}
          onSelect={onMonthChange}
          availableMonths={availableMonths}
        />
      </View>
      <View className="flex-row items-center gap-2">
        {accountFilter}
        <View ref={writeRef} collapsable={false}>
          <GlassButton
            onPress={handleWrite}
            accessibilityLabel={writeVariant === 'plus' ? (writeDot ? 'Create, new: groups' : 'Create') : 'Write a transaction'}
          >
            {writeVariant === 'plus' ? (
              <Plus size={20} strokeWidth={2.2} color={ink} />
            ) : (
              <SquarePen size={18} strokeWidth={2} color={ink} />
            )}
          </GlassButton>
          {writeDot ? (
            // Ringed in the page colour so it reads as sitting on the button's edge, not inside it.
            <View
              pointerEvents="none"
              className="absolute right-0 top-0 h-3 w-3 rounded-full"
              style={{ backgroundColor: colors.primary, borderWidth: 2, borderColor: colors.background }}
            />
          ) : null}
        </View>
      </View>
    </View>
  )
}
