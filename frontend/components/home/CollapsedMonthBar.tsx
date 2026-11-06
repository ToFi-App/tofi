import { Pressable, Text, View, type ViewStyle } from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import Animated, { type AnimatedStyle } from 'react-native-reanimated'
import { heroGradient } from '@/constants/theme'
import { MASKED_AMOUNT } from '@/lib/format/money'
import { useAmountsMasked } from '@/hooks/useAmountsMasked'
import { monthLabel, type YearMonth } from '@/lib/transactions/filterByMonth'
import { HERO_INK, signedAmount } from '@/components/home/MonthHeadline'

/** The bar's height, which Home also uses to decide where the sheet comes to rest under it. */
export const COLLAPSED_BAR_HEIGHT = 48

/**
 * What stays of Home's top section once it has scrolled away: a strip of the gradient's top colour with the
 * month, its step arrows, and the net, small — enough to know which month the tiles below belong to
 * without scrolling back. Tapping the month brings the whole top section back.
 * It's the colour behind the status bar too, so bar and status bar read as one band.
 */
export function CollapsedMonthBar({
  month,
  net,
  onPrevious,
  onNext,
  onExpand,
  isInteractive,
  style,
}: {
  month: YearMonth
  net: number
  onPrevious: () => void
  onNext: () => void
  onExpand: () => void
  /** Off while the bar is faded out, so it never catches a tap meant for the page under it. */
  isInteractive: boolean
  style: AnimatedStyle<ViewStyle>
}) {
  const { isMasked } = useAmountsMasked()
  return (
    <Animated.View
      pointerEvents={isInteractive ? 'auto' : 'none'}
      style={[
        {
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          height: COLLAPSED_BAR_HEIGHT,
          paddingHorizontal: 20,
          backgroundColor: heroGradient.stops[0],
          flexDirection: 'row',
          alignItems: 'center',
          gap: 12,
        },
        style,
      ]}
    >
      <Pressable
        onPress={onExpand}
        hitSlop={8}
        accessibilityRole="button"
        accessibilityLabel={`${monthLabel(month)}. Show summary`}
        className="shrink"
      >
        <Text className="font-display text-lg" style={{ color: HERO_INK }} numberOfLines={1}>
          {monthLabel(month)}
        </Text>
      </Pressable>
      <Text
        className="flex-1 font-sansSemi text-sm"
        style={{ color: HERO_INK, fontVariant: ['tabular-nums'] }}
        numberOfLines={1}
      >
        {isMasked ? MASKED_AMOUNT : signedAmount(net)}
      </Text>
      <View className="flex-row items-center gap-5">
        <Pressable onPress={onPrevious} accessibilityLabel="Previous month" hitSlop={8}>
          <Ionicons name="chevron-back" size={20} color={HERO_INK} />
        </Pressable>
        <Pressable onPress={onNext} accessibilityLabel="Next month" hitSlop={8}>
          <Ionicons name="chevron-forward" size={20} color={HERO_INK} />
        </Pressable>
      </View>
    </Animated.View>
  )
}
