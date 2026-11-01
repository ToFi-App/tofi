import { Stack } from 'expo-router'

/**
 * Investments' own stack, so a holding's page is pushed over the portfolio: it slides in from the
 * right and the native edge swipe takes it back, where swapping the screen's content in place did
 * neither. Every screen draws its own top bar, so the native header stays off.
 */
export default function InvestmentsLayout() {
  return <Stack screenOptions={{ headerShown: false }} />
}
