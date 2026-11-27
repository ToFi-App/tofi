import * as Haptics from 'expo-haptics'
import { Platform } from 'react-native'

/**
 * The app's one vocabulary of touch feedback, so every control speaks it the same way and the feel
 * is tuned here rather than at forty call sites.
 *
 * - tap: a real button was pressed — a soft click.
 * - select: a value changed (a tab, a pill, a toggle, a step through a chart) — the lightest tick.
 * - lift: something was picked up or set down, as in reordering — a firmer thunk.
 * - success / warn / error: how an action turned out.
 *
 * Fire-and-forget: a haptic that fails (an old device, the web build) is never worth surfacing, so
 * every call swallows its rejection. iOS already mutes all of these when the user turns System
 * Haptics off. Gesture worklets reach these through runOnJS; they are plain JS functions.
 *
 * Kept sparse on purpose: rows that push a screen and plain scrolling stay silent, as in iOS's own
 * apps, so the haptics that do fire still mean something.
 */
const enabled = Platform.OS === 'ios' || Platform.OS === 'android'

function fire(run: () => Promise<void>) {
  if (!enabled) return
  run().catch(() => {})
}

export const haptics = {
  tap: () => fire(() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)),
  select: () => fire(() => Haptics.selectionAsync()),
  lift: () => fire(() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium)),
  success: () => fire(() => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)),
  warn: () => fire(() => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning)),
  error: () => fire(() => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error)),
}
