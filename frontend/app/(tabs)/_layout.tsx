import { Ionicons } from '@expo/vector-icons'
import { Redirect, usePathname } from 'expo-router'
import { NativeTabs } from 'expo-router/unstable-native-tabs'
import { useSession } from '@/lib/supabase/auth'
import { useBudgetAlerts } from '@/hooks/useBudgetAlerts'
import { TransactionFeedProvider } from '@/components/transactions/TransactionFeedProvider'
import { AccountMarksProvider } from '@/hooks/useAccountMarks'
import { TransactionEditorProvider } from '@/components/transactions/TransactionEditorProvider'
import { useTransactionFeed } from '@/hooks/useTransactionFeed'
import { LoadingScreen } from '@/components/ui/LoadingScreen'
import { colors } from '@/constants/theme'

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
 * Ionicons rather than SF Symbols, tinted by the bar itself: teal when selected, grey otherwise.
 *
 * A function, not a component: a Trigger reads its children by element type, so a wrapper
 * component around Trigger.Icon would not be recognized as the icon.
 */
function tabIcon(name: React.ComponentProps<typeof Ionicons>['name']) {
  return <Trigger.Icon src={<Trigger.VectorIcon family={Ionicons} name={name} />} renderingMode="template" />
}

export default function TabsLayout() {
  const { session, isLoading } = useSession()
  // Groups are not part of the path, so this is cash flow inside Home's stack.
  const pathname = usePathname()

  if (isLoading) return <LoadingScreen />
  if (!session) return <Redirect href="/(auth)/login" />

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
      {/* NativeTabs is the system UITabBarController, not a JS-drawn bar: built against the iOS 26
          SDK it is the floating Liquid Glass bar, and on older iOS the standard translucent one. No
          background color on purpose — any fill would paint over the glass. The bar floats above
          screen content, so each tab's main ScrollView sets contentInsetAdjustmentBehavior to
          inset for it, and anything pinned to the bottom offsets by useSafeAreaInsets().bottom.
          Cash flow hides it, as it did when it was a hidden tab. */}
      <NativeTabs tintColor={colors.primary} hidden={pathname === '/cash-flow'}>
        <Trigger name="(home)">
          <Trigger.Label>Home</Trigger.Label>
          {tabIcon('wallet')}
        </Trigger>
        <Trigger name="accounts">
          <Trigger.Label>Accounts</Trigger.Label>
          {tabIcon('card')}
        </Trigger>
        <Trigger name="transactions">
          <Trigger.Label>Details</Trigger.Label>
          {tabIcon('calendar')}
        </Trigger>
        <Trigger name="budgets">
          <Trigger.Label>Budgets</Trigger.Label>
          {tabIcon('pie-chart')}
        </Trigger>
        <Trigger name="settings">
          <Trigger.Label>Settings</Trigger.Label>
          {tabIcon('settings')}
        </Trigger>
      </NativeTabs>
      </AuthedShell>
    </TransactionFeedProvider>
    </AccountMarksProvider>
  )
}
