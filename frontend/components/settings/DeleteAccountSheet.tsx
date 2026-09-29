import { useState } from 'react'
import { ScrollView, Text, View } from 'react-native'
import { BottomSheet, useSheetScroll } from '@/components/ui/BottomSheet'
import { Button } from '@/components/ui/Button'
import { ErrorBanner } from '@/components/ui/ErrorBanner'
import { useDeleteAccount } from '@/hooks/useDeleteAccount'
import { SheetHeader } from '@/components/ui/SheetHeader'

interface DeleteAccountSheetProps {
  visible: boolean
  onClose: () => void
}

/**
 * Two-step confirmation for account deletion.
 *
 * The consequences are spelled out before the destructive button is reachable, because this is
 * the one action in the app with nothing to undo it — there is no trash, no grace period, and
 * the Plaid Items are revoked as part of it.
 */
export function DeleteAccountSheet({ visible, onClose }: DeleteAccountSheetProps) {
  const sheetScroll = useSheetScroll()
  const { deleteAccount, isDeleting } = useDeleteAccount()
  const [error, setError] = useState<string | null>(null)

  async function handleDelete() {
    setError(null)
    try {
      await deleteAccount()
      // No navigation and no onClose: the session is gone, so the auth gate unmounts this
      // whole tree. Closing the sheet first would flash the settings screen on the way out.
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not delete your account. Try again.')
    }
  }

  function handleClose() {
    if (isDeleting) return
    setError(null)
    onClose()
  }

  return (
    <BottomSheet visible={visible} onClose={handleClose} contentScroll={sheetScroll}>
      <SheetHeader title="Delete Account" onClose={handleClose} closeDisabled={isDeleting} />

      <ScrollView
        {...sheetScroll.scrollProps}
        className="px-5"
        contentContainerClassName="gap-6 pb-10"
      >
        {error ? <ErrorBanner message={error} onDismiss={() => setError(null)} /> : null}

        <Text className="font-sans text-base leading-6 text-textSecondary">
          This permanently deletes your ToFi account. It cannot be undone.
        </Text>

        <View className="gap-3 rounded-xl bg-surface p-4">
          <Text className="font-sansMed text-sm text-textMuted">What gets deleted</Text>
          <Text className="font-sans text-sm leading-5 text-textSecondary">
            • Every linked institution, and ToFi's access to it{'\n'}• All accounts, transactions,
            and investment holdings{'\n'}• Your categories, budgets, notes, and reimbursements
            {'\n'}• Your saved Plaid developer credentials{'\n'}• Your sign-in
          </Text>
        </View>

        <Text className="font-sans text-sm leading-5 text-textMuted">
          Your own Plaid developer account stays yours — only ToFi's connection to it is removed.
          Your bank accounts themselves are untouched.
        </Text>

        <Button
          label="Delete My Account"
          variant="danger"
          onPress={handleDelete}
          loading={isDeleting}
        />
        <Button label="Cancel" variant="secondary" onPress={handleClose} disabled={isDeleting} />
      </ScrollView>
    </BottomSheet>
  )
}
