import { memo, useEffect, useRef, useState, type ReactNode } from 'react'
import { Pressable, ScrollView, Text, View, type ViewStyle } from 'react-native'
import { LinearGradient } from 'expo-linear-gradient'
import { Ionicons } from '@expo/vector-icons'
import { runOnJS, useAnimatedReaction, type AnimatedStyle, type SharedValue } from 'react-native-reanimated'
import { colors, hexToRgba, pageBackdrop } from '@/constants/theme'
import { CollapsingBar } from '@/components/ui/CollapsingBar'
import { HeroSurfaceContext } from '@/components/ui/HeroGlass'
import { DayShade } from '@/components/transactions/DayShade'
import { monthLabel, type YearMonth } from '@/lib/transactions/filterByMonth'
import { activeDayAt, centredStripOffset, isScrolledToEnd, type DayOffset } from '@/lib/transactions/dayStrip'
import type { DayHeat, DaySquare } from '@/lib/transactions/daySquares'

const DAY_WIDTH = 46
const PADDING_TOP = 8
const TOP_ROW = 40
const GAP = 6
const STRIP = 58
const PADDING_BOTTOM = 8
/** How far below the bar the list fades out, rather than being cut off at its edge. */
const EDGE_FADE = 28
/** The strip's side padding, so the first and last days don't sit flush on the screen's edges. */
const STRIP_INSET = 16

/** The bar's height, which the Calendar also uses to decide where it collapses and where a day lands. */
export const CALENDAR_BAR_HEIGHT = PADDING_TOP + TOP_ROW + GAP + STRIP + PADDING_BOTTOM

const WEEKDAY = ['S', 'M', 'T', 'W', 'T', 'F', 'S']
const NO_SQUARES: DaySquare[] = []
const NO_HEAT: DayHeat = { tone: 'expense', intensity: 0 }

interface CollapsedCalendarBarProps {
  month: YearMonth
  /** Every day of the month, in order. */
  days: { day: number; dateKey: string }[]
  dayActivity: Map<string, { squares: DaySquare[]; heat: DayHeat }>
  /** Days with a row in the list below; the rest are faded and can't be tapped. */
  datesWithRows: Set<string>
  todayKey: string
  /** The page's scroll position and the day cards' tops, for following the day being read. */
  scrollY: SharedValue<number>
  dayOffsets: SharedValue<DayOffset[]>
  /** The scroll view's own height and its content's, for telling when it has reached the end. */
  viewportHeight: SharedValue<number>
  contentHeight: SharedValue<number>
  collapseAt: number
  onDayPress: (dateKey: string) => void
  /** Back to the top, with the whole calendar showing. */
  onExpand: () => void
  filterButton: ReactNode
  isInteractive: boolean
  style: AnimatedStyle<ViewStyle>
}

/**
 * What stays of the Calendar once its grid has scrolled away: the month and the filter, over the
 * month's days in a row, each shaded as in the grid. The day being read — the topmost card still
 * showing below the bar (see activeDayAt) — is outlined and kept in the middle of the strip as the list scrolls; tapping a day jumps
 * the list to it.
 *
 * Follows the scroll itself — the day being read is worked out on the UI thread and only crosses to
 * JS when it changes — so scrolling re-renders this bar, never the month's rows under it.
 */
export function CollapsedCalendarBar({
  month,
  days,
  dayActivity,
  datesWithRows,
  todayKey,
  scrollY,
  dayOffsets,
  viewportHeight,
  contentHeight,
  collapseAt,
  onDayPress,
  onExpand,
  filterButton,
  isInteractive,
  style,
}: CollapsedCalendarBarProps) {
  const [activeDay, setActiveDay] = useState<string | null>(null)
  const stripRef = useRef<ScrollView>(null)
  const [stripWidth, setStripWidth] = useState(0)

  useAnimatedReaction(
    () =>
      collapseAt > 0 && scrollY.value >= collapseAt - 16
        ? activeDayAt(
            dayOffsets.value,
            scrollY.value + CALENDAR_BAR_HEIGHT,
            isScrolledToEnd(scrollY.value, viewportHeight.value, contentHeight.value),
          )
        : null,
    (day, previous) => {
      if (day !== previous) runOnJS(setActiveDay)(day)
    },
    [collapseAt],
  )

  // Keep the day being read in the middle of the strip.
  useEffect(() => {
    if (!activeDay || stripWidth === 0) return
    const index = days.findIndex((d) => d.dateKey === activeDay)
    if (index < 0) return
    const x = centredStripOffset(index, days.length, DAY_WIDTH, stripWidth, STRIP_INSET)
    stripRef.current?.scrollTo({ x, animated: true })
  }, [activeDay, days, stripWidth])

  return (
    <CollapsingBar
      isInteractive={isInteractive}
      style={[
        {
          height: CALENDAR_BAR_HEIGHT,
          paddingTop: PADDING_TOP,
          paddingBottom: PADDING_BOTTOM,
          gap: GAP,
          // Solid, in the page's colour (as the status bar band above it is), and the fade below
          // carries it on: the list softens out of sight before the bar instead of being sliced by it.
          backgroundColor: pageBackdrop.stops[0],
        },
        style,
      ]}
    >
      <LinearGradient
        pointerEvents="none"
        colors={[pageBackdrop.stops[0], hexToRgba(pageBackdrop.stops[0], 0)]}
        style={{ position: 'absolute', top: CALENDAR_BAR_HEIGHT, left: 0, right: 0, height: EDGE_FADE }}
      />
      <HeroSurfaceContext.Provider value="plain">
        <View className="flex-row items-center justify-between px-5" style={{ height: TOP_ROW }}>
          <Pressable
            onPress={onExpand}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel={`${monthLabel(month)}. Show calendar`}
            className="shrink flex-row items-center gap-1"
          >
            <Text className="font-display text-lg text-textPrimary" numberOfLines={1}>
              {monthLabel(month)}
            </Text>
            <Ionicons name="chevron-up" size={16} color={colors.textPrimary} />
          </Pressable>
          {filterButton}
        </View>
      </HeroSurfaceContext.Provider>

      <ScrollView
        ref={stripRef}
        horizontal
        showsHorizontalScrollIndicator={false}
        style={{ height: STRIP, flexGrow: 0 }}
        contentContainerStyle={{ paddingHorizontal: STRIP_INSET }}
        onLayout={(event) => setStripWidth(event.nativeEvent.layout.width)}
      >
        {days.map(({ day, dateKey }) => (
          <StripDay
            key={dateKey}
            dateKey={dateKey}
            day={day}
            weekday={WEEKDAY[new Date(month.year, month.month - 1, day).getDay()]}
            isToday={dateKey === todayKey}
            isActive={dateKey === activeDay}
            hasRows={datesWithRows.has(dateKey)}
            squares={dayActivity.get(dateKey)?.squares ?? NO_SQUARES}
            heat={dayActivity.get(dateKey)?.heat ?? NO_HEAT}
            onPress={onDayPress}
          />
        ))}
      </ScrollView>
    </CollapsingBar>
  )
}

const StripDay = memo(function StripDay({
  dateKey,
  day,
  weekday,
  isToday,
  isActive,
  hasRows,
  squares,
  heat,
  onPress,
}: {
  dateKey: string
  day: number
  weekday: string
  isToday: boolean
  isActive: boolean
  hasRows: boolean
  squares: DaySquare[]
  heat: DayHeat
  onPress: (dateKey: string) => void
}) {
  return (
    <View style={{ width: DAY_WIDTH, padding: 2 }}>
      <Pressable
        onPress={() => onPress(dateKey)}
        disabled={!hasRows}
        accessibilityRole="button"
        accessibilityLabel={dateKey}
        accessibilityState={{ selected: isActive, disabled: !hasRows }}
        className="flex-1 items-center justify-center gap-1"
        style={{
          overflow: 'hidden',
          borderRadius: 10,
          borderWidth: 1.5,
          borderColor: isActive ? colors.textSecondary : 'transparent',
          opacity: hasRows ? 1 : 0.35,
        }}
      >
        <DayShade id={`strip-${dateKey}`} squares={squares} heat={heat} />
        <Text className="font-sansMed text-xs text-textPrimary">{weekday}</Text>
        <Text
          className="font-sansSemi text-sm"
          style={{
            color: isToday ? colors.textInverse : colors.textPrimary,
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
      </Pressable>
    </View>
  )
})
