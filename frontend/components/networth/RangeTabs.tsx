import { Pressable, Text, View } from 'react-native'
import { colors } from '@/constants/theme'
import type { TrendRange } from '@/lib/accounts/netWorthHistory'
import { haptics } from '@/lib/ui/haptics'

/** Each range read aloud, and the caption under a headline measured over it. */
export const RANGE_LABELS: Record<TrendRange, string> = {
  '1W': 'Past week',
  '1M': 'Past month',
  '3M': 'Past 3 months',
  YTD: 'Year to date',
  '1Y': 'Past year',
  '5Y': 'Past 5 years',
  ALL: 'All time',
}

/** The underline under the chosen range. */
const UNDERLINE_W = 16

/**
 * The Net Worth tab's chart ranges: a row of plain words between two hairlines, the chosen one in
 * the brand colour with a short underline. Quieter than pills, so the chart above stays the thing
 * being read. Null selects none (a window moved by hand).
 */
export function RangeTabs({
  ranges,
  value,
  onChange,
}: {
  ranges: TrendRange[]
  value: TrendRange | null
  onChange: (range: TrendRange) => void
}) {
  return (
    <View
      className="flex-row px-3"
      style={{ borderTopWidth: 1, borderBottomWidth: 1, borderColor: colors.border }}
    >
      {ranges.map((range) => {
        const isSelected = range === value
        return (
          <Pressable
            key={range}
            onPress={() => {
              if (!isSelected) haptics.select()
              onChange(range)
            }}
            accessibilityRole="button"
            accessibilityLabel={RANGE_LABELS[range]}
            accessibilityState={{ selected: isSelected }}
            className="flex-1 items-center justify-center"
            style={{ height: 46, gap: 6 }}
          >
            <Text
              className={isSelected ? 'font-sansSemi text-sm' : 'font-sansMed text-sm'}
              style={{ color: isSelected ? colors.primary : colors.textSecondary }}
            >
              {range === 'ALL' ? 'All' : range}
            </Text>
            <View
              style={{
                width: UNDERLINE_W,
                height: 2,
                borderRadius: 1,
                backgroundColor: isSelected ? colors.primary : 'transparent',
              }}
            />
          </Pressable>
        )
      })}
    </View>
  )
}
