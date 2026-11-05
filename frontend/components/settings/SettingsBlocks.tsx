import { Children, type ReactNode } from 'react'
import { Text, View } from 'react-native'
import { borderRadius, colors, shadow } from '@/constants/theme'

/**
 * The building blocks every Settings screen is made of, so they all read alike: white cards that
 * lift off the page with a soft shadow, dark headings in sentence case, and body copy in the text
 * colour rather than grey. Grey captions under figures and controls read as washed out; hierarchy
 * here comes from weight and size instead.
 */

/** Where a settings row's label starts: the row's padding, its icon well and the gap after it. */
export const ROW_TEXT_INSET = 16 + 32 + 12

/** One white card on the page. */
export function SettingsCard({ children }: { children: ReactNode }) {
  return (
    <View className="gap-3 p-4" style={[shadow.sm, { borderRadius: borderRadius.xl, backgroundColor: colors.surface }]}>
      {children}
    </View>
  )
}

/**
 * A titled group of rows on one card, a hairline between rows that starts where their labels do —
 * the iOS settings convention, so the icons stay one clean column.
 */
export function SettingsGroup({ title, children }: { title?: string; children: ReactNode }) {
  const rows = Children.toArray(children).filter(Boolean)
  return (
    <View className="gap-2">
      {title ? <SettingsHeading>{title}</SettingsHeading> : null}
      <View style={[shadow.sm, { borderRadius: borderRadius.xl, backgroundColor: colors.surface }]}>
        <View className="overflow-hidden rounded-xl">
          {/* The hairline is its own line, indented to the labels; the row itself stays full width.
              (Insetting the row's wrapper instead shifted the whole row, icon and all.) */}
          {rows.map((row, i) => (
            <View key={i}>
              {i > 0 ? <View style={{ height: 1, marginLeft: ROW_TEXT_INSET, backgroundColor: colors.border }} /> : null}
              {row}
            </View>
          ))}
        </View>
      </View>
    </View>
  )
}

/** A group's heading above its card: dark, semibold, sentence case. */
export function SettingsHeading({ children }: { children: ReactNode }) {
  return <Text className="px-1 font-sansSemi text-sm text-textPrimary">{children}</Text>
}

/** A card's title line. */
export function SettingsTitle({ children }: { children: ReactNode }) {
  return <Text className="shrink font-sansSemi text-base text-textPrimary">{children}</Text>
}

/** A card's explanation: full-strength text at a comfortable reading size, never a grey caption. */
export function SettingsBody({ children }: { children: ReactNode }) {
  return <Text className="font-sans text-sm leading-5 text-textPrimary">{children}</Text>
}

/** On or off as a small tinted pill, so state reads at a glance instead of as faint grey text. */
export function StatusPill({ isOn, label }: { isOn: boolean; label?: string }) {
  return (
    <View className="rounded-full px-2.5 py-0.5" style={{ backgroundColor: isOn ? colors.primaryMuted : colors.surfaceRaised }}>
      <Text className="font-sansSemi text-xs" style={{ color: isOn ? colors.primary : colors.textPrimary }}>
        {label ?? (isOn ? 'On' : 'Off')}
      </Text>
    </View>
  )
}
