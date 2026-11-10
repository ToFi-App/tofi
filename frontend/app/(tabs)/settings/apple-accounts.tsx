import { ActivityIndicator, ScrollView, View } from 'react-native'
import { colors } from '@/constants/theme'
import { Button } from '@/components/ui/Button'
import { SettingsBody, SettingsCard, SettingsTitle, StatusPill } from '@/components/settings/SettingsBlocks'
import { useAppleAccountSettings } from '@/hooks/useAppleAccountSettings'
import type { AppleAccountStatus } from '@/lib/financekit/status'
import { TabBarSpacer } from '@/components/navigation/FloatingTabs'

// One line per state, saying what is true now rather than what to do about it — the controls
// underneath offer the action. Same convention as the notifications screen.
const DESCRIPTIONS: Record<Exclude<AppleAccountStatus, 'loading' | 'connected'>, string> = {
  unavailable:
    'This iPhone can’t share Apple Card data. It needs iOS 17.4 or later, and Apple Card, Apple Cash and Savings are only available in some countries.',
  unprompted:
    'Apple Card, Apple Cash and Savings can appear alongside your other accounts, so your net worth and budgets include them.',
  blocked:
    'Access to your Apple accounts is turned off for ToFi in iOS Settings. It has to be turned back on there — iOS won’t ask again from inside the app.',
  no_accounts:
    'ToFi has access, but no Apple accounts are shared yet. Choose them in iOS Settings and set each one to All Available Activity.',
}

/**
 * Apple Card, Cash and Savings. The navigation bar already names the screen, so the page opens on
 * the card itself: the state as a pill beside the title, what it means, and what can be done. Removal
 * gets a card of its own, its consequences above its button where they're read before the tap.
 */
export default function AppleAccountsSettingsScreen() {
  const apple = useAppleAccountSettings()
  const { status } = apple

  return (
    <ScrollView contentInsetAdjustmentBehavior="automatic" className="flex-1" contentContainerClassName="gap-4 px-5 py-4">
      {status === 'loading' ? (
        <View className="items-center py-8">
          <ActivityIndicator color={colors.primary} />
        </View>
      ) : (
        <>
          <SettingsCard>
            <View className="flex-row items-center justify-between gap-3">
              <SettingsTitle>Apple Card, Cash & Savings</SettingsTitle>
              {apple.isUpdating ? <ActivityIndicator size="small" color={colors.primary} /> : <StatusPill isOn={status === 'connected'} />}
            </View>

            {/* No switch, unlike the notifications screen. That switch works because an in-app flag
                sits under a granted permission; here there is no such flag, so a switch could never
                turn anything off and would flick back under the user's finger. */}
            <SettingsBody>
              {status === 'connected'
                ? `Showing ${apple.accountCount} ${apple.accountCount === 1 ? 'account' : 'accounts'}. Transactions are read from Wallet on this iPhone and never leave it.`
                : DESCRIPTIONS[status]}
            </SettingsBody>

            {status === 'unprompted' ? <Button label="Connect" onPress={() => void apple.connect()} disabled={apple.isUpdating} /> : null}
            {status === 'blocked' || status === 'no_accounts' ? (
              <Button label="Open Settings" variant="secondary" onPress={apple.openSystemSettings} />
            ) : null}
            {status === 'connected' ? <Button label="Manage in Settings" variant="secondary" onPress={apple.openSystemSettings} /> : null}
          </SettingsCard>

          {status === 'connected' ? (
            <SettingsCard>
              <SettingsTitle>Remove Apple accounts</SettingsTitle>
              {/* Honest about being half a removal: iOS permission outlives this, so the card has to
                  send the user onward to revoke — and says so before the button, not after it. */}
              <SettingsBody>
                Removing clears the copy on this device and opens iOS Settings. Until you turn access off there, your Apple
                accounts will come back the next time ToFi refreshes.
              </SettingsBody>
              <Button label="Remove" variant="danger" onPress={apple.remove} />
            </SettingsCard>
          ) : null}
        </>
      )}
      <TabBarSpacer />
    </ScrollView>
  )
}
