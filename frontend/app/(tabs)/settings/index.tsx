import { router } from 'expo-router'
import { useState } from 'react'
import { Linking, ScrollView, Text, View } from 'react-native'
import { signOut } from '@/lib/supabase/auth'
import { SettingsRow } from '@/components/ui/SettingsRow'
import { ErrorBanner } from '@/components/ui/ErrorBanner'
import { DeleteAccountSheet } from '@/components/settings/DeleteAccountSheet'
import { PRIVACY_POLICY_URL, SUPPORT_URL, TERMS_URL } from '@/constants/links'

export default function SettingsIndexScreen() {
  const [error, setError] = useState<string | null>(null)
  const [isDeleteOpen, setIsDeleteOpen] = useState(false)

  async function handleSignOut() {
    try {
      await signOut()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not sign out. Try again.')
    }
  }

  return (
    <ScrollView contentInsetAdjustmentBehavior="automatic" className="flex-1 bg-background" contentContainerClassName="gap-6 px-5 py-6">
      {error ? <ErrorBanner message={error} onDismiss={() => setError(null)} /> : null}

      <View className="gap-1">
        <Text className="px-4 font-sansMed text-sm text-textMuted">Accounts</Text>
        <View className="gap-1 rounded-md bg-surface">
          <SettingsRow icon="link" label="Linked Institutions" onPress={() => router.push('/(tabs)/settings/institutions')} />
          <SettingsRow
            icon="key"
            label="Plaid Developer Account"
            onPress={() => router.push('/(tabs)/settings/plaid-account')}
          />
          <SettingsRow icon="pricetags" label="Categories" onPress={() => router.push('/(tabs)/settings/categories')} />
        </View>
      </View>

      <View className="gap-1">
        <Text className="px-4 font-sansMed text-sm text-textMuted">Preferences</Text>
        <View className="gap-1 rounded-md bg-surface">
          <SettingsRow
            icon="notifications"
            label="Notifications"
            onPress={() => router.push('/(tabs)/settings/notifications')}
          />
          <SettingsRow
            icon="card"
            label="Apple Accounts"
            onPress={() => router.push('/(tabs)/settings/apple-accounts')}
          />
        </View>
      </View>

      <View className="gap-1">
        <Text className="px-4 font-sansMed text-sm text-textMuted">Legal</Text>
        <View className="gap-1 rounded-md bg-surface">
          <SettingsRow
            icon="shield-checkmark"
            label="Privacy Policy"
            onPress={() => Linking.openURL(PRIVACY_POLICY_URL)}
          />
          <SettingsRow
            icon="document-text"
            label="Terms of Service"
            onPress={() => Linking.openURL(TERMS_URL)}
          />
          <SettingsRow
            icon="help-circle"
            label="Support"
            onPress={() => Linking.openURL(SUPPORT_URL)}
          />
        </View>
      </View>

      <View className="gap-1">
        <Text className="px-4 font-sansMed text-sm text-textMuted">Session</Text>
        <View className="gap-1 rounded-md bg-surface">
          <SettingsRow icon="log-out" label="Sign Out" tone="danger" onPress={handleSignOut} />
          <SettingsRow
            icon="trash"
            label="Delete Account"
            tone="danger"
            onPress={() => setIsDeleteOpen(true)}
          />
        </View>
      </View>

      <DeleteAccountSheet visible={isDeleteOpen} onClose={() => setIsDeleteOpen(false)} />
    </ScrollView>
  )
}
