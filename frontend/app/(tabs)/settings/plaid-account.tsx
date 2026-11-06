import { ScrollView } from 'react-native'
import { PlaidCredentialsForm } from '@/components/plaid/PlaidCredentialsForm'
import { TabBarSpacer } from '@/components/navigation/FloatingTabs'

export default function PlaidAccountSettingsScreen() {
  return (
    <ScrollView contentInsetAdjustmentBehavior="automatic" className="flex-1 bg-background" contentContainerClassName="gap-6 px-5 py-6">
      <PlaidCredentialsForm />
      <TabBarSpacer />
    </ScrollView>
  )
}
