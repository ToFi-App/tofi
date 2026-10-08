import { ActivityIndicator, ScrollView, Switch, Text, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { colors } from '@/constants/theme'
import { Button } from '@/components/ui/Button'
import { useNotificationSettings } from '@/hooks/useNotificationSettings'

// One line per state, saying what is true now rather than what to do about it — the control
// underneath is what offers the action, and a blocked row is the only one that needs directions.
const DESCRIPTIONS: Record<string, string> = {
  on: 'You’ll get a notification when spending in a category passes the alert line you set on its budget.',
  off: 'Budget alerts are off. Your alert lines are kept, so turning this back on picks up where you left off.',
  unprompted: 'Get a notification when spending in a category passes the alert line you set on its budget.',
  blocked: 'Notifications are turned off for ToFi in iOS Settings. They have to be turned back on there before budget alerts can reach you.',
}

export default function NotificationSettingsScreen() {
  const notifications = useNotificationSettings()
  const { status } = notifications

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }} edges={['top']}>
      <ScrollView contentInsetAdjustmentBehavior="automatic" contentContainerClassName="gap-4 px-5 py-4">
        <Text className="font-sansSemi text-lg text-textPrimary">Notifications</Text>

        {status === 'loading' ? (
          <View className="items-center py-8">
            <ActivityIndicator color={colors.primary} />
          </View>
        ) : (
          <View className="gap-4 rounded-md bg-surface px-4 py-4">
            <View className="flex-row items-center justify-between gap-3">
              <Text className="font-sansMed text-base text-textPrimary">Budget Alerts</Text>
              {/* Blocked is the one state with no switch: iOS has spent its single prompt, so a
                  switch here could only ever flick back to off under the user's finger. */}
              {status === 'blocked' ? (
                <Text className="font-sansMed text-sm text-textMuted">Off</Text>
              ) : notifications.isUpdating ? (
                <ActivityIndicator size="small" color={colors.primary} />
              ) : (
                <Switch
                  value={status === 'on'}
                  onValueChange={(next) => void notifications.setEnabled(next)}
                  accessibilityLabel="Budget alerts"
                />
              )}
            </View>

            <Text className="font-sans text-sm text-textSecondary">{DESCRIPTIONS[status]}</Text>

            {status === 'blocked' ? (
              <Button label="Open Settings" variant="secondary" onPress={notifications.openSystemSettings} />
            ) : null}
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  )
}
