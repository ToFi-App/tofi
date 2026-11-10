import { Stack } from 'expo-router'
import { colors, pageBackdrop } from '@/constants/theme'

/**
 * Settings and its pages, on the app's page colour (pageBackdrop's top), header and screens alike so
 * the two meet seamlessly.
 *
 * A flat colour rather than the PageBackdrop component: the stack paints React Navigation's own grey
 * page colour behind any screen left transparent, so a backdrop laid under the stack never shows.
 */
export default function SettingsLayout() {
  return (
    <Stack
      screenOptions={{
        contentStyle: { backgroundColor: pageBackdrop.stops[0] },
        headerStyle: { backgroundColor: pageBackdrop.stops[0] },
        headerTintColor: colors.textPrimary,
        headerShadowVisible: false,
        headerTitleStyle: { fontFamily: 'Inter_600SemiBold' },
        headerBackButtonDisplayMode: 'minimal',
      }}
    >
      <Stack.Screen name="index" options={{ title: 'Settings' }} />
      <Stack.Screen name="plaid-account" options={{ title: 'Plaid Developer Account' }} />
      <Stack.Screen name="categories" options={{ title: 'Categories' }} />
      <Stack.Screen name="category-form" options={{ title: 'Category' }} />
      <Stack.Screen name="institutions" options={{ title: 'Linked Institutions' }} />
      <Stack.Screen name="notifications" options={{ title: 'Notifications' }} />
      <Stack.Screen name="apple-accounts" options={{ title: 'Apple Accounts' }} />
    </Stack>
  )
}
