import { Ionicons } from '@expo/vector-icons'
import { Redirect, usePathname } from 'expo-router'
import { NativeTabs } from 'expo-router/unstable-native-tabs'
import { isLiquidGlassAvailable } from 'expo-glass-effect'
import { useSession } from '@/lib/supabase/auth'
import { useBudgetAlerts } from '@/hooks/useBudgetAlerts'
import { TransactionFeedProvider } from '@/components/transactions/TransactionFeedProvider'
import { AccountMarksProvider } from '@/hooks/useAccountMarks'
import { TransactionEditorProvider } from '@/components/transactions/TransactionEditorProvider'
import { useTransactionFeed } from '@/hooks/useTransactionFeed'
import { LoadingScreen } from '@/components/ui/LoadingScreen'
import { colors } from '@/constants/theme'
import { FloatingTabs } from '@/components/navigation/FloatingTabs'
import { requestHomeTop } from '@/hooks/useHomeTabReselect'

// Rendered (not called) inside the authed layout so its data hooks never run logged-out.
function BudgetAlertWatcher() {
  useBudgetAlerts()
  return null
}

/**
 * The editor and the sheet host, both mounted once for the whole tab tree.
 *
 * A component of its own because the editor needs the feed, which only exists inside
 * TransactionFeedProvider — and the host has to sit below the feed for the same reason a layer's
 * content can read it. TransactionEditorProvider mounts the host itself, so the ordering the
 * layers depend on lives in one file rather than being spelled out again here.
 *
 * The editor used to be mounted inside AccountDetailSheet and CategoryDetailSheet, which put the
 * edit sheet's Modal inside the subtree of the sheet that opened it. On iOS that nesting made touch
 * delivery unrecoverable; presenting the two as siblings instead makes them fight for the screen.
 * One host with stacked layers is the only arrangement that avoids both, and it requires the editor
 * to live above it.
 */
function AuthedShell({ children }: { children: React.ReactNode }) {
  const { feed } = useTransactionFeed()

  return <TransactionEditorProvider feed={feed}>{children}</TransactionEditorProvider>
}

const { Trigger } = NativeTabs

/**
 * Whether the system tab bar is the floating Liquid Glass one (iOS 26 and later). Before that the
 * system bar is a solid strip that can't float, so FloatingTabs draws a capsule to match instead.
 * Fixed for the life of the process, since it depends on the OS and the SDK the binary was built with.
 */
const HAS_LIQUID_GLASS = isLiquidGlassAvailable()

/**
 * Ionicons rather than SF Symbols, tinted by the bar itself: teal when selected, grey otherwise.
 *
 * A function, not a component: a Trigger reads its children by element type, so a wrapper
 * component around Trigger.Icon would not be recognized as the icon.
 */
function tabIcon(name: React.ComponentProps<typeof Ionicons>['name']) {
  return <Trigger.Icon src={<Trigger.VectorIcon family={Ionicons} name={name} />} renderingMode="template" />
}

/** Home's own screens, as paths: groups aren't part of the path, so its index is the root. */
const HOME_PATHS = new Set(['/', '/budgets'])

export default function TabsLayout() {
  const { session, isLoading } = useSession()
  const pathname = usePathname()

  if (isLoading) return <LoadingScreen />
  if (!session) return <Redirect href="/(auth)/login" />

  const onHomeReselect = () => {
    if (HOME_PATHS.has(pathname)) requestHomeTop()
  }

  // The provider wraps the watcher as well as the screens: it is a feed consumer too, and one
  // of the six independent copies of the feed this replaced.
  // Outermost, above the feed and therefore above the sheet host: sheet layers render inside the
  // host rather than where they were written, so anything they read has to be resolvable from
  // there. Every transaction row reads this.
  return (
    <AccountMarksProvider>
    <TransactionFeedProvider>
      <BudgetAlertWatcher />
      <AuthedShell>
      {/* On iOS 26 and later, NativeTabs: the system UITabBarController, built against the iOS 26
          SDK the floating Liquid Glass bar. The bar sits over screen content, so each tab's main
          ScrollView sets contentInsetAdjustmentBehavior to inset for it, and anything pinned to the
          bottom offsets by useSafeAreaInsets().bottom. Before iOS 26 the system bar can't float, so
          FloatingTabs draws a matching capsule instead, with the screens ending above it.

          disableTransparentOnScrollEdge stays as a guard: on iOS 17/18 the system bar goes fully
          transparent whenever it believes its screen's list is scrolled to the bottom; iOS 26's
          glass bar has no transparent edge state, so it is unaffected. */}
      {HAS_LIQUID_GLASS ? (
      <NativeTabs
        tintColor={colors.primary}
        disableTransparentOnScrollEdge
      >
        {/* Home is where the money goes (with budgets inside it), Calendar the same month day by day,
            Net Worth what there is — the overview, and the invested part of it, behind one switch. */}
        {/* Tapped again while already on Home, it takes Home back to its top. From another tab it
            returns to Home as it was left — that tap's path is the other tab's, not Home's. */}
        <Trigger
          name="(home)"
          listeners={{ tabPress: onHomeReselect }}
        >
          <Trigger.Label>Home</Trigger.Label>
          {tabIcon('home')}
        </Trigger>
        <Trigger name="calendar">
          <Trigger.Label>Calendar</Trigger.Label>
          {tabIcon('calendar')}
        </Trigger>
        <Trigger name="net-worth">
          <Trigger.Label>Net Worth</Trigger.Label>
          {tabIcon('wallet')}
        </Trigger>
        <Trigger name="settings">
          <Trigger.Label>Settings</Trigger.Label>
          {tabIcon('settings')}
        </Trigger>
      </NativeTabs>
      ) : (
        // Before iOS 26: the same four tabs in a floating capsule of our own, with the screens
        // running under it as they do under the system bar on iOS 26.
        <FloatingTabs
          tabs={[
            { name: '(home)', href: '/', label: 'Home', icon: 'home', onReselect: onHomeReselect },
            { name: 'calendar', href: '/calendar', label: 'Calendar', icon: 'calendar' },
            { name: 'net-worth', href: '/net-worth', label: 'Net Worth', icon: 'wallet' },
            { name: 'settings', href: '/settings', label: 'Settings', icon: 'settings' },
          ]}
        />
      )}
      </AuthedShell>
    </TransactionFeedProvider>
    </AccountMarksProvider>
  )
}
