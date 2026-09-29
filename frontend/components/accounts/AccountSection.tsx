import type { ReactNode } from 'react'
import { Pressable, Text, View } from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import { borderRadius, colors, hexToRgba, shadow, spacing } from '@/constants/theme'
import { formatMaskableAmount } from '@/lib/format/money'
import type { NetWorthSeriesGroup } from '@/lib/accounts/netWorthSeries'
import { GROUP_COLORS } from './netWorthPalette'

/**
 * The one panel every account section sits in: plain white, with no border and only the faintest
 * shadow. Sections inside are split by their header bands.
 *
 * Plain views only, no blur or glass: those are native modules, and a native change means a new
 * build and App Store review instead of an over-the-air update.
 */
export function AccountConsole({ children }: { children: ReactNode }) {
  return (
    // The shadow sits on its own wrapper: iOS drops the shadow of a view that clips its content,
    // and the inner view has to clip so the header bands follow the rounded corners.
    // Pulled 8px into the screen's side padding, so the console runs closer to the edges than the
    // page's other content.
    <View style={[shadow.sm, { borderRadius: borderRadius.xl, backgroundColor: colors.surface, marginHorizontal: -spacing[2] }]}>
      <View className="overflow-hidden rounded-xl bg-surface px-4 pb-1">
        {children}
      </View>
    </View>
  )
}

// How strongly each header band is tinted. Cash's grey carries almost no colour, so the same tint
// that reads clearly in blue or rose all but vanishes in grey; it gets roughly twice as much.
const BAND_OPACITY: Record<NetWorthSeriesGroup, number> = {
  cash: 0.2,
  investment: 0.1,
  liability: 0.1,
}

interface AccountSectionProps {
  title: string
  total: number
  /** Which kind of money this is. Picks the header's colours, the same ones the Net Worth sheet uses. */
  group: NetWorthSeriesGroup
  isMasked: boolean
  isOpen: boolean
  onToggle: () => void
  children: ReactNode
}

/**
 * One collapsible group inside the AccountConsole: a status dot, the name as a small uppercase
 * instrument label, and the total in the same mono face as the balances so their digits line up.
 * Tapping the header collapses the group.
 */
export function AccountSection({ title, total, group, isMasked, isOpen, onToggle, children }: AccountSectionProps) {
  // One palette with the Net Worth sheet, so a group reads as the same kind of money in both:
  // `fill` for the dot and the band, the deeper `text` shade for the words and the total.
  const tone = GROUP_COLORS[group]
  return (
    <View>
      {/* The header is a band tinted in the section's tone, run edge to edge across the console
          (the negative margin undoes the console's side padding) — that band, not a hairline, is
          what marks where one group ends and the next begins. */}
      <Pressable
        onPress={onToggle}
        accessibilityRole="button"
        accessibilityLabel={title}
        accessibilityState={{ expanded: isOpen }}
        className="flex-row items-center gap-2.5 py-3"
        style={{ marginHorizontal: -spacing[4], paddingHorizontal: spacing[4], backgroundColor: hexToRgba(tone.fill, BAND_OPACITY[group]) }}
      >
        {/* A dot inside a soft ring, like a status light. */}
        <View className="h-3 w-3 items-center justify-center rounded-full" style={{ backgroundColor: hexToRgba(tone.fill, 0.18) }}>
          <View className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: tone.fill }} />
        </View>
        <Text className="flex-1 font-mono text-xs uppercase" style={{ color: tone.text, letterSpacing: 1.6 }}>
          {title}
        </Text>
        <Text className="font-mono text-base" style={{ color: tone.text }} numberOfLines={1}>
          {formatMaskableAmount(total, isMasked)}
        </Text>
        <Ionicons name={isOpen ? 'chevron-down' : 'chevron-forward'} size={12} color={colors.textMuted} />
      </Pressable>
      {isOpen ? <View>{children}</View> : null}
    </View>
  )
}
