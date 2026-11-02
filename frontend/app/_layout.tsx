import '../global.css'
import {
  DMSans_700Bold,
  useFonts as useDMSansFonts,
} from '@expo-google-fonts/dm-sans'
import {
  Inter_400Regular,
  Inter_500Medium,
  Inter_600SemiBold,
  useFonts as useInterFonts,
} from '@expo-google-fonts/inter'
import { JetBrainsMono_400Regular, useFonts as useMonoFonts } from '@expo-google-fonts/jetbrains-mono'
import { QueryClient } from '@tanstack/react-query'
import { PersistQueryClientProvider } from '@tanstack/react-query-persist-client'
import { queryPersister } from '@/lib/storage/queryPersister'
import * as SplashScreen from 'expo-splash-screen'
import { StatusBar } from 'expo-status-bar'
import { Stack } from 'expo-router'
import { useEffect, useRef, useState } from 'react'
import { View } from 'react-native'
import { GestureHandlerRootView } from 'react-native-gesture-handler'
import { SafeAreaProvider } from 'react-native-safe-area-context'
import { usePurgeSessionOnFreshInstall } from '@/hooks/usePurgeSessionOnFreshInstall'
import { useResetCacheOnUserChange } from '@/hooks/useResetCacheOnUserChange'
import { api, createApiClient } from '@/lib/api/client'
// Side-effect import: defineTask must run at module scope so the task exists when iOS
// launches the app headless for a background wake — not just when the UI mounts.
import { registerBudgetAlertTask } from '@/lib/background/budgetAlertTask'
import { colors } from '@/constants/theme'

SplashScreen.preventAutoHideAsync()

export default function RootLayout() {
  const [dmSansLoaded] = useDMSansFonts({ DMSans_700Bold })
  const [interLoaded] = useInterFonts({ Inter_400Regular, Inter_500Medium, Inter_600SemiBold })
  const [monoLoaded] = useMonoFonts({ JetBrainsMono_400Regular })
  const fontsLoaded = dmSansLoaded && interLoaded && monoLoaded

  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            // Stale-while-revalidate: restored/persisted data renders immediately and anything
            // older than a minute refetches in the background. cacheTime must outlive maxAge
            // below, or restored queries would be garbage-collected on arrival.
            staleTime: 60 * 1000,
            cacheTime: 24 * 60 * 60 * 1000,
          },
        },
      }),
  )
  const [trpcClient] = useState(() => createApiClient())

  // The caches outlive any one session — drop them when the signed-in user changes so one
  // user's data can never render for the next.
  useResetCacheOnUserChange(queryClient)

  // The Keychain outlives an uninstall, so a reinstall would otherwise restore the previous
  // session. Nothing may render until this resolves, or the redirect in `app/index.tsx`
  // runs against the session being torn down.
  const isPurgingSession = usePurgeSessionOnFreshInstall()

  // The persisted-cache restore finishes a beat after first render. Without waiting for it,
  // that beat renders every query as "loading" — a one-frame flash of the loading screen
  // before the snapshot lands, which reads as a glitch. Holding the native splash until the
  // restore reports done makes launch go splash -> content with nothing in between.
  const [isCacheRestored, setIsCacheRestored] = useState(false)
  // Failsafe: a restore that throws (corrupt snapshot, storage error) never calls onSuccess.
  // Better one flash of the loading screen than a splash that never lifts.
  const restoreFailsafe = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => {
    restoreFailsafe.current = setTimeout(() => setIsCacheRestored(true), 1500)
    return () => {
      if (restoreFailsafe.current) clearTimeout(restoreFailsafe.current)
    }
  }, [])

  const isReady = fontsLoaded && !isPurgingSession && isCacheRestored

  useEffect(() => {
    void registerBudgetAlertTask()
  }, [])

  useEffect(() => {
    if (isReady) {
      SplashScreen.hideAsync()
    }
  }, [isReady])

  // The providers mount unconditionally so the cache restore runs in parallel with font
  // loading and the fresh-install purge, rather than starting only after they finish.
  return (
    // The one root-level gesture handler: individual screens (e.g. TrendChart's scrub
    // gesture) need a GestureHandlerRootView ancestor to work at all. BottomSheet carries its
    // own separate one because Modal content mounts in a detached native hierarchy that this
    // root never reaches — the two are solving different problems, not duplicating each other.
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
      <PersistQueryClientProvider
        client={queryClient}
        persistOptions={{ persister: queryPersister, maxAge: 24 * 60 * 60 * 1000 }}
        onSuccess={() => setIsCacheRestored(true)}
      >
        <api.Provider client={trpcClient} queryClient={queryClient}>
          {isReady ? (
            <View className="flex-1 bg-background">
              <StatusBar style="dark" />
              <Stack
                screenOptions={{
                  headerShown: false,
                  contentStyle: { backgroundColor: colors.background },
                }}
              />
            </View>
          ) : (
            // Splash is still covering the window; this only has to hold the space.
            <View className="flex-1 bg-background" />
          )}
        </api.Provider>
      </PersistQueryClientProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  )
}
