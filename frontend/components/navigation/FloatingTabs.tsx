import type { ComponentProps } from 'react'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import { BlurView } from 'expo-blur'
import { TabList, TabSlot, TabTrigger, Tabs, type TabTriggerSlotProps } from 'expo-router/ui'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { isLiquidGlassAvailable } from 'expo-glass-effect'
import { colors, shadow } from '@/constants/theme'

/** The capsule's height, and its distance from the screen's sides and from the home indicator. */
const BAR_HEIGHT = 64
const BAR_INSET = 16
const BAR_BOTTOM_GAP = 4
/** Clear space kept between a screen's last row and the top of the capsule. */
const BAR_CLEARANCE = 12
/** Whether this bar is the one drawn (iOS before 26); on iOS 26 the system's glass bar is used. */
const DRAWS_OWN_BAR = !isLiquidGlassAvailable()

/** Where the capsule's bottom edge sits above the screen's bottom. */
function barBottom(safeBottom: number): number {
  return Math.max(safeBottom - BAR_BOTTOM_GAP, 12)
}

/**
 * How much more a scrolling screen must leave at its end, on top of the safe-area inset its scroll
 * view already gets, for its last row to scroll clear of the floating capsule. Zero on iOS 26, where
 * the system bar adds its own inset.
 */
export function useTabBarOverlap(): number {
  const insets = useSafeAreaInsets()
  if (!DRAWS_OWN_BAR) return 0
  return Math.max(barBottom(insets.bottom) + BAR_HEIGHT + BAR_CLEARANCE - insets.bottom, 0)
}

/**
 * The room a scrolling screen leaves at its end so its last row can scroll clear of the floating
 * capsule, which content runs under. Goes last inside the scroll view's content; nothing on iOS 26.
 */
export function TabBarSpacer() {
  const overlap = useTabBarOverlap()
  return overlap > 0 ? <View style={{ height: overlap }} /> : null
}

export interface FloatingTab {
  /** The route's name under (tabs), e.g. "(home)" or "calendar". */
  name: string
  href: '/' | '/calendar' | '/net-worth' | '/settings'
  label: string
  icon: ComponentProps<typeof Ionicons>['name']
  /** Tapped again while already showing — Home uses it to go back to its top. */
  onReselect?: () => void
}

/**
 * The tab bar for iOS before 26, drawn to match the system's floating Liquid Glass bar on iOS 26: a
 * capsule inset from the screen's edges and lifted off the home indicator, on iOS's standard thin
 * material (Liquid Glass itself only exists from iOS 26), with the selected tab sitting in a pill of
 * its own and taking the brand teal.
 *
 * Built on Expo Router's headless tabs, since the system tab bar before iOS 26 can't float. Screens
 * run under the capsule, as they do under the system bar on iOS 26. A JS-drawn bar doesn't give
 * their scroll views the automatic bottom inset the system bar does, so each scrolling screen ends
 * with a TabBarSpacer to let its last row scroll clear of it.
 */
export function FloatingTabs({ tabs }: { tabs: FloatingTab[] }) {
  const insets = useSafeAreaInsets()
  const bottom = barBottom(insets.bottom)

  return (
    <Tabs style={{ flex: 1 }}>
      <TabSlot />
      <TabList asChild>
        <View
          style={{
            position: 'absolute',
            left: BAR_INSET,
            right: BAR_INSET,
            bottom,
            height: BAR_HEIGHT,
            borderRadius: BAR_HEIGHT / 2,
            flexDirection: 'row',
            alignItems: 'center',
            paddingHorizontal: 6,
            ...shadow.lift,
          }}
        >
          <BlurView
            intensity={100}
            tint="systemThinMaterialLight"
            style={[
              StyleSheet.absoluteFill,
              { borderRadius: BAR_HEIGHT / 2, overflow: 'hidden', borderWidth: StyleSheet.hairlineWidth, borderColor: colors.frostCardBorder },
            ]}
          />
          {tabs.map((tab) => (
            <TabTrigger key={tab.name} name={tab.name} href={tab.href} asChild>
              <TabButton label={tab.label} icon={tab.icon} onReselect={tab.onReselect} />
            </TabTrigger>
          ))}
        </View>
      </TabList>
    </Tabs>
  )
}

/** One tab: icon over label, in a pill of its own while selected. */
function TabButton({
  label,
  icon,
  onReselect,
  isFocused,
  onPress,
  ...props
}: TabTriggerSlotProps & { label: string; icon: FloatingTab['icon']; onReselect?: () => void }) {
  const ink = isFocused ? colors.primary : colors.textPrimary
  return (
    <Pressable
      {...props}
      onPress={(e) => {
        if (isFocused) onReselect?.()
        onPress?.(e)
      }}
      accessibilityRole="tab"
      accessibilityState={{ selected: isFocused }}
      accessibilityLabel={label}
      style={{ flex: 1 }}
    >
      <View
        style={{
          height: BAR_HEIGHT - 12,
          borderRadius: (BAR_HEIGHT - 12) / 2,
          alignItems: 'center',
          justifyContent: 'center',
          gap: 2,
          backgroundColor: isFocused ? colors.primaryMuted : 'transparent',
        }}
      >
        <Ionicons name={icon} size={22} color={ink} />
        <Text className="font-sansSemi text-xs" style={{ color: ink }} numberOfLines={1}>
          {label}
        </Text>
      </View>
    </Pressable>
  )
}
