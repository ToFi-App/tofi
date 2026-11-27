import { useState, type ReactNode } from 'react'
import { Pressable, Text, View } from 'react-native'
import { colors, hexToRgba } from '@/constants/theme'

/** A row's corners: rounder than a rule, squarer than the app's cards. */
const ROW_RADIUS = 12

/**
 * One row of the Net Worth tab's lists — an account, a position, a trade: a rounded tile with a thin
 * rim, the mark on the left, a name over a line of detail, and the figures on the right. Each row
 * stands on its own rather than sharing a card, so where one ends and the next begins is never in
 * doubt.
 *
 * The drag handlers of a reorderable list go on this same Pressable (see ReorderableList), never a
 * wrapper around it, or the long-press never reaches it. The pressed tint is kept in state rather
 * than a style function of `pressed`, which NativeWind's Pressable drops.
 */
export function ListCard({
  mark,
  title,
  subtitle,
  right,
  onPress,
  onLongPress,
  onPressOut,
  delayLongPress,
  accessibilityLabel,
}: {
  mark: ReactNode
  title: string
  subtitle?: string | null
  right?: ReactNode
  onPress?: () => void
  onLongPress?: () => void
  onPressOut?: () => void
  delayLongPress?: number
  accessibilityLabel?: string
}) {
  const [isPressed, setIsPressed] = useState(false)
  return (
    <Pressable
      onPress={onPress}
      onLongPress={onLongPress}
      onPressIn={() => setIsPressed(true)}
      onPressOut={() => {
        setIsPressed(false)
        onPressOut?.()
      }}
      delayLongPress={delayLongPress}
      disabled={!onPress && !onLongPress}
      accessibilityRole={onPress ? 'button' : undefined}
      accessibilityLabel={accessibilityLabel}
      className="flex-row items-center gap-3 px-3.5 py-3"
      style={{
        borderRadius: ROW_RADIUS,
        borderWidth: 1,
        borderColor: colors.borderCard,
        backgroundColor: isPressed ? colors.surfaceRaised : colors.surfaceRow,
      }}
    >
      {mark}
      <View className="flex-1 gap-0.5">
        <Text className="font-sansSemi text-amount text-textPrimary" numberOfLines={1}>
          {title}
        </Text>
        {subtitle ? (
          <Text className="font-sans text-xs text-textSecondary" numberOfLines={1}>
            {subtitle}
          </Text>
        ) : null}
      </View>
      {right ? <View className="items-end gap-1">{right}</View> : null}
    </Pressable>
  )
}

/** The figure at the right of a ListCard, in tabular digits so a column of them lines up. */
export function ListCardValue({ children, color = colors.textPrimary }: { children: string; color?: string }) {
  return (
    <Text className="font-sansSemi text-amount" style={{ color, fontVariant: ['tabular-nums'] }} numberOfLines={1}>
      {children}
    </Text>
  )
}

/** A round mark for a row with no logo of its own: a letter on a soft tint of its group's colour. */
export function LetterMark({ letter, color, size = 36 }: { letter: string; color: string; size?: number }) {
  return (
    <View
      className="items-center justify-center"
      style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: hexToRgba(color, 0.1) }}
    >
      <Text className="font-sansSemi text-sm" style={{ color }}>
        {letter}
      </Text>
    </View>
  )
}

/** A list's heading inside the tab: the section's name, with room on the right for a total or a link. */
export function SectionTitle({ title, right }: { title: string; right?: ReactNode }) {
  return (
    <View className="flex-row items-center justify-between">
      <Text className="font-display text-md text-textPrimary" accessibilityRole="header">
        {title}
      </Text>
      {right}
    </View>
  )
}
