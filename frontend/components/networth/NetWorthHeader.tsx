import { useState, type ReactNode } from 'react'
import { Pressable, Text, View, useWindowDimensions } from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import { ChevronsUpDown } from 'lucide-react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { colors, flowColors, hexToRgba } from '@/constants/theme'
import { BottomSheet } from '@/components/ui/BottomSheet'
import { setNetWorthScope, useNetWorthScope, type NetWorthScope } from '@/hooks/useNetWorthScope'
import { setInvestmentAccountFilter } from '@/hooks/useInvestmentAccountFilter'
import { formatMaskableAmount } from '@/lib/format/money'
import { haptics } from '@/lib/ui/haptics'

/** The switcher sheet's height above the home indicator: the grabber, a heading and two rows. */
const SWITCHER_HEIGHT = 250

/**
 * Investments as the switcher (or a swipe) opens it: all of them. An account row on the Overview
 * opens it filtered to that account, and that filter shouldn't still be standing the next time you
 * come back this way.
 */
export function showAllInvestments() {
  setInvestmentAccountFilter(null)
  setNetWorthScope('investments')
}

const VIEWS: Array<{ scope: NetWorthScope; title: string; icon: 'grid' | 'trending-up'; color: string }> = [
  { scope: 'overview', title: 'Overview', icon: 'grid', color: colors.primary },
  { scope: 'investments', title: 'Investments', icon: 'trending-up', color: flowColors.invested },
]

interface NetWorthHeaderProps {
  /** Each view's total, for the switcher's rows; null where there's nothing to total yet. */
  totals: Record<NetWorthScope, number | null>
  isMasked: boolean
  /** The view's own controls, at the right end of the row: adding an account, the account filter. */
  actions?: ReactNode
}

/**
 * The top of the Net Worth tab: the view's name as the screen's title, with a small square button
 * beside it that opens a sheet to switch between Overview and Investments, each with its total.
 * The views are also a swipe apart (SwipeViews); the title says which one this is.
 */
export function NetWorthHeader({ totals, isMasked, actions }: NetWorthHeaderProps) {
  const [scope] = useNetWorthScope()
  const [isOpen, setIsOpen] = useState(false)
  const { height } = useWindowDimensions()
  const insets = useSafeAreaInsets()
  const title = scope === 'overview' ? 'Overview' : 'Investments'

  const open = () => {
    haptics.tap()
    setIsOpen(true)
  }
  const choose = (next: NetWorthScope) => {
    setIsOpen(false)
    if (next === scope) return
    haptics.select()
    if (next === 'investments') showAllInvestments()
    else setNetWorthScope('overview')
  }

  return (
    <View className="flex-row items-center justify-between pl-5 pr-3">
      <Pressable
        onPress={open}
        accessibilityRole="button"
        accessibilityLabel={`${title}. Switch view`}
        hitSlop={6}
        className="flex-row items-center gap-3"
      >
        <View
          className="items-center justify-center"
          style={{ width: 36, height: 36, borderRadius: 10, borderWidth: 1, borderColor: colors.borderCard }}
        >
          <ChevronsUpDown size={16} strokeWidth={2.2} color={colors.textPrimary} />
        </View>
        <Text className="font-display text-xl text-textPrimary" style={{ letterSpacing: -0.4 }}>
          {title}
        </Text>
      </Pressable>
      <View className="flex-row items-center">{actions}</View>

      <BottomSheet visible={isOpen} onClose={() => setIsOpen(false)} topOffset={height - SWITCHER_HEIGHT - insets.bottom}>
        <View className="px-5">
          {VIEWS.map((view, i) => {
            const isCurrent = view.scope === scope
            const total = totals[view.scope]
            return (
              <Pressable
                key={view.scope}
                onPress={() => choose(view.scope)}
                accessibilityRole="button"
                accessibilityState={{ selected: isCurrent }}
                className="flex-row items-center gap-3 py-4"
                style={i > 0 ? { borderTopWidth: 1, borderColor: colors.border } : undefined}
              >
                <View
                  className="items-center justify-center rounded-full"
                  style={{ width: 36, height: 36, backgroundColor: hexToRgba(view.color, 0.1) }}
                >
                  <Ionicons name={view.icon} size={17} color={view.color} />
                </View>
                <Text className="flex-1 font-display text-md text-textPrimary">{view.title}</Text>
                {total != null ? (
                  <Text className="font-sansSemi text-base text-textPrimary" style={{ fontVariant: ['tabular-nums'] }}>
                    {formatMaskableAmount(total, isMasked)}
                  </Text>
                ) : null}
                <View style={{ width: 20 }}>
                  {isCurrent ? <Ionicons name="checkmark-circle" size={20} color={colors.primary} /> : null}
                </View>
              </Pressable>
            )
          })}
        </View>
      </BottomSheet>
    </View>
  )
}

/** A round outlined button for the header's right end, sized to the 44pt touch target. */
export function HeaderIconButton({
  onPress,
  accessibilityLabel,
  disabled,
  children,
}: {
  onPress: () => void
  accessibilityLabel: string
  disabled?: boolean
  children: ReactNode
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      className="items-center justify-center"
      style={{ width: 44, height: 44 }}
    >
      <View
        className="items-center justify-center rounded-full"
        style={{ width: 36, height: 36, borderWidth: 1, borderColor: colors.borderCard }}
      >
        {children}
      </View>
    </Pressable>
  )
}
