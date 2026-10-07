import { Pressable, Text, View } from 'react-native'
import { colors } from '@/constants/theme'
import type { TrendRange } from '@/lib/accounts/netWorthHistory'

export const RANGE_LABELS: Record<TrendRange, string> = {
  '1W': 'Past week',
  '1M': 'Past month',
  '3M': 'Past 3 months',
  YTD: 'Year to date',
  '1Y': 'Past year',
  '5Y': 'Past 5 years',
  ALL: 'All time',
}

/** One pill: view switches and range rows share it, lettered like the account console's headers. */
export function Pill({
  label,
  isSelected,
  onPress,
  accessibilityLabel,
}: {
  label: string
  isSelected: boolean
  onPress: () => void
  accessibilityLabel?: string
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityState={{ selected: isSelected }}
      hitSlop={6}
      className="rounded-full px-3 py-1.5"
      style={isSelected ? { backgroundColor: colors.primary } : undefined}
    >
      {/* The console's instrument lettering: uppercase mono, widely tracked. */}
      <Text
        className="font-mono text-xs uppercase"
        style={{ color: isSelected ? colors.surface : colors.primary, letterSpacing: 1.6 }}
      >
        {label}
      </Text>
    </Pressable>
  )
}

/** A chart's range choices as a row of pills; null selects none (a window moved by hand). */
export function RangePills({
  ranges,
  value,
  onChange,
}: {
  ranges: TrendRange[]
  value: TrendRange | null
  onChange: (range: TrendRange) => void
}) {
  return (
    <View className="flex-row justify-between">
      {ranges.map((option) => (
        <Pill
          key={option}
          label={option === 'ALL' ? 'All' : option}
          accessibilityLabel={RANGE_LABELS[option]}
          isSelected={option === value}
          onPress={() => onChange(option)}
        />
      ))}
    </View>
  )
}
