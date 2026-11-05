import type { ReactNode } from 'react'
import { Pressable, View } from 'react-native'
import { SquarePen } from 'lucide-react-native'
import { colors } from '@/constants/theme'
import { MonthNavigator } from '@/components/transactions/MonthNavigator'
import { AccountsFilterDropdown } from '@/components/ui/AccountsFilterDropdown'
import { shiftMonth, type YearMonth } from '@/lib/transactions/filterByMonth'
import type { Account } from '@/types/domain'

/** Matches the filter icon beside it, so the two read as one row of controls. */
const WRITE_ICON_SIZE = 22

interface MonthHeaderProps {
  month: YearMonth
  onMonthChange: (month: YearMonth) => void
  accounts: Account[]
  selectedAccountId: string | null
  onAccountChange: (accountId: string | null) => void
  onWrite: () => void
  /** A control of the screen's own, placed before the filter — Home's Summary/Charts switch. */
  extra?: ReactNode
  /** 'inverse' for a header on the brand colour. */
  tone?: 'default' | 'inverse'
}

/**
 * The header row Home and Calendar share, since they show the same month for the same accounts: the
 * month leads on the left as the screen's heading, and the controls sit at the right — the screen's
 * own (if any), the account filter as an icon, and the write button last, where the thumb reaches.
 */
export function MonthHeader({
  month,
  onMonthChange,
  accounts,
  selectedAccountId,
  onAccountChange,
  onWrite,
  extra,
  tone = 'default',
}: MonthHeaderProps) {
  return (
    <View className="flex-row items-center justify-between gap-3">
      <MonthNavigator
        variant="header"
        tone={tone}
        month={month}
        onPrevious={() => onMonthChange(shiftMonth(month, -1))}
        onNext={() => onMonthChange(shiftMonth(month, 1))}
        onSelect={onMonthChange}
      />
      <View className="flex-row items-center gap-4">
        {extra}
        <AccountsFilterDropdown variant="icon" tone={tone} accounts={accounts} selectedAccountId={selectedAccountId} onSelect={onAccountChange} />
        <WriteButton onPress={onWrite} tone={tone} />
      </View>
    </View>
  )
}

/**
 * Write a transaction: Lucide's square-and-pen, a cleaner compose mark than Ionicons' outline,
 * drawn as an outline glyph like the filter beside it and in the header's ink — white on the brand
 * colour.
 */
function WriteButton({ onPress, tone }: { onPress: () => void; tone: 'default' | 'inverse' }) {
  return (
    <Pressable onPress={onPress} hitSlop={8} accessibilityRole="button" accessibilityLabel="Write a transaction">
      {({ pressed }) => (
        <SquarePen
          size={WRITE_ICON_SIZE}
          strokeWidth={2}
          color={tone === 'inverse' ? colors.textInverse : colors.textPrimary}
          style={{ opacity: pressed ? 0.6 : 1 }}
        />
      )}
    </Pressable>
  )
}
