import { memo } from 'react'
import { Pressable, Text } from 'react-native'
import { colors } from '@/constants/theme'
import type { DayHeat, DaySquare } from '@/lib/transactions/daySquares'
import { DayShade } from './DayShade'
import { haptics } from '@/lib/ui/haptics'

interface CalendarCellProps {
  /** Passed back to onPress so the grid can share one callback across all 42 cells. */
  dateKey: string
  day: number
  netAmount: number | null
  hasReimbursement: boolean
  isToday: boolean
  isSelected: boolean
  onPress: (dateKey: string) => void
  /** The day's spending by category, largest first (see daySquares) — blended into its shade. */
  squares: DaySquare[]
  /** The cell's heat shade: the day's net direction and strength (see dayHeat). */
  heat: DayHeat
}

function CalendarCellComponent({
  dateKey,
  day,
  netAmount,
  isToday,
  isSelected,
  onPress,
  squares,
  heat,
}: CalendarCellProps) {
  const amountColor = netAmount == null ? colors.textMuted : netAmount < 0 ? colors.income : colors.expense
  const dateColor = isToday ? colors.textInverse : colors.textPrimary

  return (
    <Pressable
      onPress={() => {
        if (!isSelected) haptics.select()
        onPress(dateKey)
      }}
      accessibilityRole="button"
      accessibilityState={{ selected: isSelected }}
      className="items-center justify-center py-2"
      style={{
        // The shade is DayShade, below. Selection is an outline rather than a fill, so it doesn't
        // hide the shade it sits on.
        overflow: 'hidden',
        borderRadius: 8,
        borderWidth: 1.5,
        borderColor: isSelected ? colors.textSecondary : 'transparent',
        marginHorizontal: 1,
        marginVertical: 1,
      }}
    >
      <DayShade id={`day-${dateKey}`} squares={squares} heat={heat} />
      <Text
        className="font-sansMed text-sm"
        style={{
          color: dateColor,
          backgroundColor: isToday ? colors.expense : 'transparent',
          borderRadius: 12,
          overflow: 'hidden',
          width: 24,
          height: 24,
          lineHeight: 24,
          textAlign: 'center',
        }}
      >
        {day}
      </Text>
      {netAmount != null ? (
        <Text className="font-sans" style={{ color: amountColor, fontSize: 9, marginTop: 2 }}>
          ${Math.abs(netAmount).toFixed(netAmount > 999 ? 0 : 2)}
        </Text>
      ) : null}
    </Pressable>
  )
}

/** Memoized: 42 of these re-rendered on every sheet open before this. */
export const CalendarCell = memo(CalendarCellComponent)
