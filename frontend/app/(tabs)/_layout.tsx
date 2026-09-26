import { Ionicons } from '@expo/vector-icons'
import { Redirect, Tabs } from 'expo-router'
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

export default function TabsLayout() {
  const { session, isLoading } = useSession()

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
      <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: colors.textMuted,
        tabBarStyle: { backgroundColor: colors.surface, borderTopColor: colors.border },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: 'Home',
          tabBarIcon: ({ color, size }) => <Ionicons name="wallet" color={color} size={size} />,
        }}
      />
      <Tabs.Screen
        name="accounts"
        options={{
          title: 'Accounts',
          tabBarIcon: ({ color, size }) => <Ionicons name="card" color={color} size={size} />,
        }}
      />
      <Tabs.Screen
        name="transactions"
        options={{
          title: 'Details',
          tabBarIcon: ({ color, size }) => <Ionicons name="calendar" color={color} size={size} />,
        }}
      />
      <Tabs.Screen
        name="budgets"
        options={{
          title: 'Budgets',
          tabBarIcon: ({ color, size }) => <Ionicons name="pie-chart" color={color} size={size} />,
        }}
      />
      <Tabs.Screen
        name="settings"
        options={{
          title: 'Settings',
          tabBarIcon: ({ color, size }) => <Ionicons name="settings" color={color} size={size} />,
        }}
      />
      {/* Opened from Home's top bar rather than the tab bar. A hidden tab rather than a root stack
          screen because it needs the feed and editor providers mounted here. */}
      <Tabs.Screen name="cash-flow" options={{ href: null, tabBarStyle: { display: 'none' } }} />
      </Tabs>
      </AuthedShell>
    </TransactionFeedProvider>
    </AccountMarksProvider>
  )
}
