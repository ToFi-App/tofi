import { Ionicons } from '@expo/vector-icons'
import { useState } from 'react'
import { Linking, Pressable, ScrollView, Text, View } from 'react-native'
import { usePlaidCredentials, type PlaidEnvironment } from '@/hooks/usePlaidCredentials'
import { Button } from '@/components/ui/Button'
import { TextField } from '@/components/ui/TextField'
import { SecretInput } from '@/components/ui/SecretInput'
import { SegmentedControl } from '@/components/ui/SegmentedControl'
import { BottomSheet, useSheetScroll } from '@/components/ui/BottomSheet'
import { colors, shadow } from '@/constants/theme'
import { reportError } from '@/lib/observability/log'

interface PlaidCredentialsFormProps {
  onSaved?: () => void
}

type TestResult = { status: 'idle' } | { status: 'success' } | { status: 'error'; message: string }

export function PlaidCredentialsForm({ onSaved }: PlaidCredentialsFormProps) {
  const { data: existing, allowedEnvironments, isLoading, test, isTesting, save, isSaving } = usePlaidCredentials()

  const sheetScroll = useSheetScroll()
  const [isHowToOpen, setIsHowToOpen] = useState(false)
  const [replaceOpen, setReplaceOpen] = useState(false)
  // No default. The environment is permanent once saved, so it must be chosen deliberately
  // rather than inherited from whatever the control happened to start on.
  const [environment, setEnvironment] = useState<PlaidEnvironment | null>(null)
  const [clientId, setClientId] = useState('')
  const [secret, setSecret] = useState('')
  const [testResult, setTestResult] = useState<TestResult>({ status: 'idle' })

  const isNewSetup = !existing
  const canChooseEnvironment = allowedEnvironments.length > 1

  // Client ID and environment are fixed at first save, so a rotation resends the stored
  // values verbatim; only the secret is the user's to change. The server rejects anything
  // else, so this keeps the client honest rather than merely convenient.
  const submission = existing
    ? { clientId: existing.clientId, secret, environment: existing.environment as PlaidEnvironment }
    : { clientId, secret, environment: (canChooseEnvironment ? environment : 'production') as PlaidEnvironment }

  async function handleTest() {
    setTestResult({ status: 'idle' })
    try {
      const result = await test(submission)
      if (result.ok) {
        setTestResult({ status: 'success' })
      } else {
        setTestResult({ status: 'error', message: result.message })
      }
    } catch (err) {
      // The user gets a generic message on purpose; the cause is only useful to us.
      reportError('plaid-credentials-test', err)
      setTestResult({ status: 'error', message: 'Something went wrong reaching Plaid. Try again.' })
    }
  }

  async function handleSave() {
    const result = await save(submission)
    if (result.ok) {
      setReplaceOpen(false)
      setClientId('')
      setSecret('')
      setTestResult({ status: 'idle' })
      onSaved?.()
    } else {
      setTestResult({ status: 'error', message: result.message })
    }
  }

  function handleCloseReplace() {
    setReplaceOpen(false)
    setClientId('')
    setSecret('')
    setTestResult({ status: 'idle' })
  }

  if (isLoading) return null

  const canTest =
    submission.secret.trim().length > 0 &&
    submission.clientId.trim().length > 0 &&
    // Only blocks the first save; a rotation inherits the stored environment.
    (!isNewSetup || !canChooseEnvironment || environment !== null)
  const canSave = canTest && testResult.status === 'success' && !isSaving

  const formFields = (
    <>
      {isNewSetup && canChooseEnvironment ? (
        <View className="gap-2">
          <Text className="font-sansSemi text-sm text-textPrimary">Environment</Text>
          <SegmentedControl
            value={environment}
            onChange={setEnvironment}
            options={[
              { label: 'Sandbox', value: 'sandbox' },
              { label: 'Production', value: 'production' },
            ]}
          />
          <Text className="font-sans text-xs leading-4 text-textPrimary">
            This cannot be changed later — linked banks are tied to the environment they were
            connected in.
          </Text>
        </View>
      ) : null}

      {isNewSetup ? (
        <TextField
          label="Client ID"
          value={clientId}
          onChangeText={setClientId}
          autoCapitalize="none"
          autoCorrect={false}
          mono
        />
      ) : null}

      <SecretInput value={secret} onChangeText={setSecret} />

      {testResult.status === 'success' ? (
        <View className="flex-row items-center gap-2">
          <Ionicons name="checkmark-circle" size={16} color={colors.income} />
          <Text className="font-sans text-sm text-income">Connection verified</Text>
        </View>
      ) : null}
      {testResult.status === 'error' ? (
        <View className="flex-row items-center gap-2">
          <Ionicons name="close-circle" size={16} color={colors.expense} />
          <Text className="font-sans text-sm text-expense">{testResult.message}</Text>
        </View>
      ) : null}

      <Button label="Test Connection" variant="secondary" onPress={handleTest} loading={isTesting} disabled={!canTest} />
      <Button label="Save" onPress={handleSave} disabled={!canSave} loading={isSaving} />
    </>
  )

  // New setup: show form inline (onboarding flow)
  if (isNewSetup) {
    return (
      <View className="gap-6">
        <View className="gap-2">
          <Text className="font-sansSemi text-lg text-textPrimary">Plaid Developer Account</Text>
          <Text className="font-sans text-sm leading-5 text-textPrimary">
            ToFi uses your own free Plaid developer account so your linked banks stay under your own
            usage.
          </Text>
        </View>

        <Pressable
          onPress={() => setIsHowToOpen((prev) => !prev)}
          accessibilityRole="button"
          className="flex-row items-center gap-3 rounded-lg border p-4 active:opacity-80"
          style={{ borderColor: colors.primary, backgroundColor: colors.primaryMuted }}
        >
          <View
            className="h-9 w-9 items-center justify-center rounded-full"
            style={{ backgroundColor: colors.primary }}
          >
            <Ionicons name="key" size={18} color={colors.textInverse} />
          </View>
          <View className="flex-1 gap-0.5">
            <Text className="font-sansSemi text-base text-primary">How do I get these?</Text>
            <Text className="font-sans text-xs text-textPrimary">
              Free Plaid account — about 2 minutes
            </Text>
          </View>
          <Ionicons
            name={isHowToOpen ? 'chevron-up' : 'chevron-down'}
            size={18}
            color={colors.primary}
          />
        </Pressable>

        {isHowToOpen ? (
          <View className="gap-4 rounded-xl bg-surface p-4" style={shadow.sm}>
            <View className="flex-row gap-3">
              <View className="h-5 w-5 items-center justify-center rounded-full bg-primaryMuted">
                <Text className="font-sansSemi text-xs text-primary">1</Text>
              </View>
              <View className="flex-1 gap-1">
                <Text className="font-sans text-sm leading-5 text-textPrimary">
                  Create a free Plaid account.
                </Text>
                <Text className="font-sans text-xs leading-4 text-textPrimary">
                  When it asks what the account is for, choose Personal.
                </Text>
              </View>
            </View>

            <View className="flex-row gap-3">
              <View className="h-5 w-5 items-center justify-center rounded-full bg-primaryMuted">
                <Text className="font-sansSemi text-xs text-primary">2</Text>
              </View>
              <View className="flex-1 gap-1">
                <Text className="font-sans text-sm leading-5 text-textPrimary">
                  Request free Trial access — this unlocks real bank data.
                </Text>
                <Text className="font-sans text-xs leading-4 text-textPrimary">
                  Plaid will ask for your name and address here. That's Plaid's own requirement
                  for real bank data, not ToFi's — approval is usually quick.
                </Text>
              </View>
            </View>

            <View className="flex-row gap-3">
              <View className="h-5 w-5 items-center justify-center rounded-full bg-primaryMuted">
                <Text className="font-sansSemi text-xs text-primary">3</Text>
              </View>
              <Text className="flex-1 font-sans text-sm leading-5 text-textPrimary">
                Copy your Production Client ID and Production Secret from Developers → Keys,
                then come back here and paste them in.
              </Text>
            </View>

            <Button
              label="Open Plaid Sign Up"
              variant="secondary"
              onPress={() => Linking.openURL('https://dashboard.plaid.com/signup')}
            />
          </View>
        ) : null}

        {formFields}
      </View>
    )
  }

  // Existing credentials: read-only summary + a sheet that rotates the secret only. Client ID
  // and environment are fixed for the life of the account, so they are shown, not edited.
  return (
    <View className="gap-6">
      <View className="gap-2">
        <Text className="font-sansSemi text-lg text-textPrimary">Plaid Developer Account</Text>
        <Text className="font-sans text-sm leading-5 text-textPrimary">
          Your Plaid developer account is connected.
        </Text>
      </View>

      <View className="gap-4 rounded-xl bg-surface p-4" style={shadow.sm}>
        <View className="gap-1">
          <Text className="font-sansSemi text-sm text-textPrimary">Client ID</Text>
          <Text className="font-mono text-base text-textPrimary">{existing.clientId}</Text>
        </View>
        <View className="gap-1">
          <Text className="font-sansSemi text-sm text-textPrimary">Secret</Text>
          <Text className="font-mono text-base text-textPrimary">••••••••••••••••</Text>
        </View>
        <View className="gap-1">
          <Text className="font-sansSemi text-sm text-textPrimary">Environment</Text>
          <Text className="font-sansMed text-base text-textPrimary capitalize">{existing.environment}</Text>
        </View>
      </View>

      <Button label="Update Secret" variant="secondary" onPress={() => setReplaceOpen(true)} />

      <BottomSheet visible={replaceOpen} onClose={handleCloseReplace} contentScroll={sheetScroll}>
        <View className="flex-row items-center justify-between px-5 py-3">
          <Pressable onPress={handleCloseReplace} hitSlop={8}>
            <Ionicons name="close" size={22} color={colors.textSecondary} />
          </Pressable>
          <Text className="font-display text-md text-textPrimary">Update Secret</Text>
          <View style={{ width: 22 }} />
        </View>

        <ScrollView {...sheetScroll.scrollProps} className="px-5" contentContainerClassName="gap-6 pb-10" keyboardShouldPersistTaps="handled">
          {formFields}
        </ScrollView>
      </BottomSheet>
    </View>
  )
}
