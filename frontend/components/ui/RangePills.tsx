import { Pressable, Text, View } from 'react-native'
import { colors, hexToRgba } from '@/constants/theme'
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

/** One pill: view switches and range rows share it, lettered in Inter like the rest of the app. */
export function Pill({
  label,
  isSelected,
  onPress,
  accessibilityLabel,
  tone = 'default',
  size = 'sm',
}: {
  label: string
  isSelected: boolean
  onPress: () => void
  accessibilityLabel?: string
  /** 'inverse' for a pill on the brand colour: white when selected, softened white when not. */
  tone?: 'default' | 'inverse'
  /** 'md' for pills that head a screen, a step under the month pill in Home's header (HomeHeader);
   *  'sm' for a row of options under a chart. */
  size?: 'sm' | 'md'
}) {
  const isInverse = tone === 'inverse'
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityState={{ selected: isSelected }}
      hitSlop={6}
      className={size === 'md' ? 'rounded-full px-3.5 py-1.5' : 'rounded-full px-3 py-1.5'}
      style={isSelected ? { backgroundColor: isInverse ? colors.textInverse : colors.primary } : undefined}
    >
      <Text
        className={size === 'md' ? 'font-sansSemi text-base' : 'font-sansSemi text-sm'}
        style={{
          color: isSelected ? (isInverse ? colors.primary : colors.surface) : isInverse ? hexToRgba(colors.textInverse, 0.72) : colors.primary,
        }}
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
