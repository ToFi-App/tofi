import { Stack } from 'expo-router'

/**
 * Home's own stack, so cash flow can be pushed over it.
 *
 * Cash flow used to be a hidden tab, but the native tab bar drops hidden routes entirely and throws
 * when one is focused. As a screen in this stack it still sits under the tab layout's feed and
 * editor providers — the reason it was not a root stack screen — and gains the native swipe back.
 * The tab layout hides the tab bar while it is showing.
 *
 * Both screens draw their own top bar, so the native header stays off.
 */
export default function HomeLayout() {
  return <Stack screenOptions={{ headerShown: false }} />
}
