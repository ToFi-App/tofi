import { ActivityIndicator, ScrollView, Text, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { colors } from '@/constants/theme'
import { Button } from '@/components/ui/Button'
import { useAppleAccountSettings } from '@/hooks/useAppleAccountSettings'
import type { AppleAccountStatus } from '@/lib/financekit/status'

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

export default function AppleAccountsSettingsScreen() {
  const apple = useAppleAccountSettings()
  const { status } = apple

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }} edges={['top']}>
      <ScrollView contentInsetAdjustmentBehavior="automatic" contentContainerClassName="gap-4 px-5 py-4">
        <Text className="font-sansSemi text-lg text-textPrimary">Apple Accounts</Text>

        {status === 'loading' ? (
          <View className="items-center py-8">
            <ActivityIndicator color={colors.primary} />
          </View>
        ) : (
          <View className="gap-4 rounded-md bg-surface px-4 py-4">
            <View className="flex-row items-center justify-between gap-3">
              <Text className="font-sansMed text-base text-textPrimary">Apple Card, Cash & Savings</Text>
              {apple.isUpdating ? (
                <ActivityIndicator size="small" color={colors.primary} />
              ) : (
                <Text className="font-sansMed text-sm text-textMuted">
                  {status === 'connected' ? 'On' : 'Off'}
                </Text>
              )}
            </View>

            {/* No switch, unlike the notifications screen. That switch works because an in-app flag
                sits under a granted permission; here there is no such flag, so a switch could never
                turn anything off and would flick back under the user's finger. */}
            <Text className="font-sans text-sm text-textSecondary">
              {status === 'connected'
                ? `Showing ${apple.accountCount} ${apple.accountCount === 1 ? 'account' : 'accounts'}. Transactions are read from Wallet on this iPhone and never leave it.`
                : DESCRIPTIONS[status]}
            </Text>

            {status === 'unprompted' ? (
              <Button label="Connect" onPress={() => void apple.connect()} disabled={apple.isUpdating} />
            ) : null}

            {status === 'blocked' || status === 'no_accounts' ? (
              <Button label="Open Settings" variant="secondary" onPress={apple.openSystemSettings} />
            ) : null}

            {status === 'connected' ? (
              <View className="gap-2">
                <Button label="Manage in Settings" variant="secondary" onPress={apple.openSystemSettings} />
                {/* Honest about being half a removal: iOS permission outlives this, so the copy on
                    the button's own screen has to send the user onward to revoke. */}
                <Button label="Remove Apple accounts" variant="danger" onPress={apple.remove} />
                <Text className="font-sans text-xs text-textMuted">
                  Removing clears the copy on this device and opens iOS Settings. Until you turn access
                  off there, your Apple accounts will come back the next time ToFi refreshes.
                </Text>
              </View>
            ) : null}
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  )
}
