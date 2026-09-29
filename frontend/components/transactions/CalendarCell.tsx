import { memo } from 'react'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg'
import { colors, hexToRgba } from '@/constants/theme'
import { blendStops, type DayHeat, type DaySquare } from '@/lib/transactions/daySquares'
import { formatAmount } from '@/lib/format/money'

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

// Shade range: faint enough at the top that the date and amount stay readable on it. The category
// blend runs a touch stronger than a flat tint, since its colours share the cell between them.
const HEAT_MIN = 0.04
const HEAT_MAX = 0.2
const BLEND_MIN = 0.15
const BLEND_MAX = 0.4

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
  // Spending days show what they were spent on: their categories, blended diagonally across the
  // cell in proportion (see blendStops). Only on net spending days — an income day stays green.
  const stops = heat.tone === 'expense' && heat.intensity > 0 ? blendStops(squares) : []
  const blend = stops.length > 0
  const blendOpacity = BLEND_MIN + (BLEND_MAX - BLEND_MIN) * heat.intensity
  const amountColor = netAmount == null ? colors.textMuted : netAmount < 0 ? colors.income : colors.expense
  const dateColor = isToday ? colors.textInverse : colors.textPrimary

  return (
    <Pressable
      onPress={() => onPress(dateKey)}
      accessibilityRole="button"
      accessibilityState={{ selected: isSelected }}
      className="items-center justify-center py-2"
      style={{
        // GitHub-activity heat, stronger the bigger the day: a net income day is a flat green; a
        // net spending day blends its categories' colours instead (the gradient below). Selection
        // is an outline rather than a fill, so it doesn't hide the shade it sits on.
        backgroundColor:
          heat.intensity > 0 && !blend
            ? hexToRgba(heat.tone === 'income' ? colors.income : colors.expense, HEAT_MIN + (HEAT_MAX - HEAT_MIN) * heat.intensity)
            : 'transparent',
        overflow: 'hidden',
        borderRadius: 8,
        borderWidth: 1.5,
        borderColor: isSelected ? colors.textSecondary : 'transparent',
        marginHorizontal: 1,
        marginVertical: 1,
      }}
    >
      {blend ? (
        // The wrapper fills the cell; the Svg fills the wrapper. Positioned directly, the Svg sizes
        // itself from its width/height props and ignores the absolute insets, covering only part.
        <View pointerEvents="none" style={StyleSheet.absoluteFill}>
        <Svg width="100%" height="100%">
          <Defs>
            <LinearGradient id={`day-${dateKey}`} x1="0" y1="0" x2="1" y2="1">
              {stops.map((stop, i) => (
                <Stop key={i} offset={stop.offset} stopColor={stop.color} stopOpacity={blendOpacity} />
              ))}
            </LinearGradient>
          </Defs>
          <Rect x="0" y="0" width="100%" height="100%" fill={`url(#day-${dateKey})`} />
        </Svg>
        </View>
      ) : null}
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
