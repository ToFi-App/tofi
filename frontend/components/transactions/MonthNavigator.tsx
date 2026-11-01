import { useRef, useState } from 'react'
import { Ionicons } from '@expo/vector-icons'
import { Dimensions, Modal, Pressable, Text, View } from 'react-native'
import { colors, shadow } from '@/constants/theme'
import { currentMonth, monthLabel, type YearMonth } from '@/lib/transactions/filterByMonth'

const MONTH_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

const POPOVER_WIDTH = 264
const SCREEN_MARGIN = 12

interface MonthNavigatorProps {
  month: YearMonth
  onPrevious: () => void
  onNext: () => void
  /** Jump straight to a month/year picked from the label's popover. */
  onSelect: (month: YearMonth) => void
  /** 'title' draws the month as the page's large title, left-aligned, with the step arrows at the
   *  right — for a screen whose whole subject is the month. The title still opens the picker, but
   *  carries no chevron of its own: beside the arrows it was one mark too many. Defaults to the
   *  compact centred control. */
  variant?: 'inline' | 'title'
}

export function MonthNavigator({ month, onPrevious, onNext, onSelect, variant = 'inline' }: MonthNavigatorProps) {
  const labelRef = useRef<View>(null)
  // Popover position in window coordinates, null while closed. A small anchored card keeps a
  // quick month hop lightweight — a bottom sheet reads as a whole task, this reads as a menu.
  const [anchor, setAnchor] = useState<{ left: number; top: number } | null>(null)
  // The popover browses years without committing until a month is tapped, so its year is
  // deliberately separate state from the applied `month`, re-seeded on every open.
  const [pickerYear, setPickerYear] = useState(month.year)
  const today = currentMonth()

  function openPicker() {
    setPickerYear(month.year)
    labelRef.current?.measureInWindow((x, y, width, height) => {
      const screenWidth = Dimensions.get('window').width
      const centered = x + width / 2 - POPOVER_WIDTH / 2
      const left = Math.min(Math.max(centered, SCREEN_MARGIN), screenWidth - POPOVER_WIDTH - SCREEN_MARGIN)
      setAnchor({ left, top: y + height + 8 })
    })
  }

  function close() {
    setAnchor(null)
  }

  const isTitle = variant === 'title'
  const previous = (
    <Pressable onPress={onPrevious} accessibilityLabel="Previous month" hitSlop={8}>
      <Ionicons name="chevron-back" size={20} color={colors.textSecondary} />
    </Pressable>
  )
  const next = (
    <Pressable onPress={onNext} accessibilityLabel="Next month" hitSlop={8}>
      <Ionicons name="chevron-forward" size={20} color={colors.textSecondary} />
    </Pressable>
  )

  return (
    <>
      {isTitle ? (
        <View className="flex-row items-center justify-between">
          <Pressable
            ref={labelRef}
            onPress={openPicker}
            accessibilityRole="header"
            accessibilityLabel={`${monthLabel(month)}. Select month and year`}
            hitSlop={8}
            className="shrink flex-row items-center gap-1.5"
          >
            <Text className="shrink font-display text-xl text-textPrimary" numberOfLines={1}>
              {monthLabel(month)}
            </Text>
          </Pressable>
          <View className="flex-row items-center gap-5">
            {previous}
            {next}
          </View>
        </View>
      ) : (
        <View className="flex-row items-center justify-center gap-4">
          {previous}
          <Pressable
            ref={labelRef}
            onPress={openPicker}
            accessibilityLabel="Select month and year"
            hitSlop={8}
            className="flex-row items-center gap-1"
          >
            <Text className="font-sansSemi text-base text-textPrimary">{monthLabel(month)}</Text>
            <Ionicons name="chevron-down" size={13} color={colors.textSecondary} />
          </Pressable>
          {next}
        </View>
      )}

      <Modal transparent visible={anchor != null} animationType="fade" onRequestClose={close}>
        {/* Full-screen backdrop: any tap outside the card dismisses. Kept transparent — the
            popover is a passing menu, and dimming the screen would make it as heavy as the
            sheet it replaced. */}
        <Pressable style={{ flex: 1 }} onPress={close} accessibilityLabel="Dismiss month picker">
          {anchor ? (
            <Pressable
              // Swallows taps so presses inside the card don't bubble to the backdrop.
              onPress={() => {}}
              style={[
                {
                  position: 'absolute',
                  left: anchor.left,
                  top: anchor.top,
                  width: POPOVER_WIDTH,
                  backgroundColor: colors.surface,
                  borderRadius: 16,
                  borderWidth: 1,
                  borderColor: colors.border,
                  paddingHorizontal: 8,
                  paddingVertical: 8,
                },
                shadow.md,
              ]}
            >
              <View className="flex-row items-center justify-between px-2 pb-2">
                <Pressable onPress={() => setPickerYear((year) => year - 1)} accessibilityLabel="Previous year" hitSlop={8}>
                  <Ionicons name="chevron-back" size={18} color={colors.textSecondary} />
                </Pressable>
                <Text className="font-sansSemi text-base text-textPrimary">{pickerYear}</Text>
                <Pressable onPress={() => setPickerYear((year) => year + 1)} accessibilityLabel="Next year" hitSlop={8}>
                  <Ionicons name="chevron-forward" size={18} color={colors.textSecondary} />
                </Pressable>
              </View>

              <View className="flex-row flex-wrap">
                {MONTH_SHORT.map((name, index) => {
                  const value = index + 1
                  const isSelected = pickerYear === month.year && value === month.month
                  const isCurrent = pickerYear === today.year && value === today.month
                  return (
                    <View key={name} style={{ width: '33.33%', padding: 3 }}>
                      <Pressable
                        onPress={() => {
                          onSelect({ year: pickerYear, month: value })
                          close()
                        }}
                        accessibilityLabel={`${name} ${pickerYear}`}
                        className="items-center rounded-lg py-2"
                        style={{
                          backgroundColor: isSelected ? colors.primary : 'transparent',
                          // The current calendar month stays findable while browsing other years.
                          borderWidth: 1,
                          borderColor: isCurrent && !isSelected ? colors.primary : 'transparent',
                        }}
                      >
                        <Text
                          className="font-sansMed text-sm"
                          style={{ color: isSelected ? colors.surface : colors.textPrimary }}
                        >
                          {name}
                        </Text>
                      </Pressable>
                    </View>
                  )
                })}
              </View>
            </Pressable>
          ) : null}
        </Pressable>
      </Modal>
    </>
  )
}
