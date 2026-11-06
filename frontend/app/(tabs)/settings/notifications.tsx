import { ActivityIndicator, ScrollView, Switch, View } from 'react-native'
import { colors } from '@/constants/theme'
import { Button } from '@/components/ui/Button'
import { SettingsBody, SettingsCard, SettingsTitle, StatusPill } from '@/components/settings/SettingsBlocks'
import { useNotificationSettings } from '@/hooks/useNotificationSettings'
import { TabBarSpacer } from '@/components/navigation/FloatingTabs'

// One line per state, saying what is true now rather than what to do about it — the control
// underneath is what offers the action, and a blocked row is the only one that needs directions.
const DESCRIPTIONS: Record<string, string> = {
  on: 'You’ll get a notification when spending in a category passes the alert line you set on its budget.',
  off: 'Budget alerts are off. Your alert lines are kept, so turning this back on picks up where you left off.',
  unprompted: 'Get a notification when spending in a category passes the alert line you set on its budget.',
  blocked: 'Notifications are turned off for ToFi in iOS Settings. They have to be turned back on there before budget alerts can reach you.',
}

/** Budget alerts. The navigation bar names the screen, so the page opens on the card itself. */
export default function NotificationSettingsScreen() {
  const notifications = useNotificationSettings()
  const { status } = notifications

  return (
    <ScrollView contentInsetAdjustmentBehavior="automatic" className="flex-1 bg-background" contentContainerClassName="gap-4 px-5 py-4">
      {status === 'loading' ? (
        <View className="items-center py-8">
          <ActivityIndicator color={colors.primary} />
        </View>
      ) : (
        <SettingsCard>
          <View className="flex-row items-center justify-between gap-3">
            <SettingsTitle>Budget alerts</SettingsTitle>
            {/* Blocked is the one state with no switch: iOS has spent its single prompt, so a switch
                here could only ever flick back to off under the user's finger. */}
            {status === 'blocked' ? (
              <StatusPill isOn={false} />
            ) : notifications.isUpdating ? (
              <ActivityIndicator size="small" color={colors.primary} />
            ) : (
              <Switch
                value={status === 'on'}
                onValueChange={(next) => void notifications.setEnabled(next)}
                trackColor={{ true: colors.primary }}
                accessibilityLabel="Budget alerts"
              />
            )}
          </View>

          <SettingsBody>{DESCRIPTIONS[status]}</SettingsBody>

          {status === 'blocked' ? <Button label="Open Settings" variant="secondary" onPress={notifications.openSystemSettings} /> : null}
        </SettingsCard>
      )}
      <TabBarSpacer />
    </ScrollView>
  )
}
