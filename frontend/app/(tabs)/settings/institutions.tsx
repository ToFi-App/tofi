import { useMemo, useState } from 'react'
import { Alert, Image, Pressable, ScrollView, Text, View } from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import { colors } from '@/constants/theme'
import { api } from '@/lib/api/client'
import { useAccounts } from '@/hooks/useAccounts'
import { useLinkSession } from '@/hooks/useLinkSession'
import { formatAmount } from '@/lib/format/money'
import { clearItemCache } from '@/lib/storage/mmkv'
import { ErrorBanner } from '@/components/ui/ErrorBanner'
import { LoadingScreen } from '@/components/ui/LoadingScreen'
import { EmptyState } from '@/components/ui/EmptyState'
import type { Account } from '@/types/domain'

// One card per institution — guaranteed by clean-slate linking: relinking an institution
// replaces its previous connection, so duplicates can't accumulate here.
//
// Every action here except "Delete permanently" reuses the connection that already exists.
// That is deliberate: a Plaid plan caps how many Items an account may create for all time and
// /item/remove never gives one back, so revoking is a one-way door that costs an allowance to
// walk back through. Disconnecting instead leaves the Item intact and reversible for free.
export default function InstitutionsScreen() {
  const [error, setError] = useState<string | null>(null)
  const utils = api.useUtils()
  const { data: institutions, isLoading } = api.accounts.listInstitutions.useQuery()
  const accounts = useAccounts()
  const { openUpdateLink, isConnecting, error: linkError, setError: setLinkError } = useLinkSession()

  const refresh = () => {
    utils.accounts.listInstitutions.invalidate()
    utils.accounts.list.invalidate()
  }

  const onError = (message: string) => (err: { message?: string }) => setError(err.message ?? message)

  const disconnectMutation = api.accounts.disconnectInstitution.useMutation({
    onSuccess: (_data, variables) => {
      // Cached transactions and cursor go together — see clearItemCache. Without this,
      // reconnecting would resume past the discarded history and never re-deliver it.
      clearItemCache(variables.itemId)
      refresh()
    },
    onError: onError('Could not disconnect this institution. Try again.'),
  })

  const reconnectMutation = api.accounts.reconnectInstitution.useMutation({
    onSuccess: refresh,
    onError: onError('Could not reconnect this institution. Try again.'),
  })

  const removeMutation = api.accounts.removeInstitution.useMutation({
    onSuccess: refresh,
    onError: onError('Could not remove this institution. Try again.'),
  })

  const accountsByItem = useMemo(() => {
    const map = new Map<string, Account[]>()
    for (const account of accounts.data ?? []) {
      const group = map.get(account.itemId) ?? []
      group.push(account)
      map.set(account.itemId, group)
    }
    return map
  }, [accounts.data])

  const busy = disconnectMutation.isLoading || reconnectMutation.isLoading || removeMutation.isLoading || isConnecting

  function confirmDelete(itemId: string, name: string) {
    Alert.alert(
      'Delete Permanently?',
      `This revokes access to ${name} at Plaid and cannot be undone. Reconnecting it later will use up another Plaid connection.`,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Delete', style: 'destructive', onPress: () => removeMutation.mutate({ itemId }) },
      ],
    )
  }

  function handleRemovePress(itemId: string, name: string) {
    Alert.alert(
      name,
      'Disconnecting stops syncing but keeps the connection, so you can turn it back on any time at no cost.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Disconnect', onPress: () => disconnectMutation.mutate({ itemId }) },
        { text: 'Delete Permanently', style: 'destructive', onPress: () => confirmDelete(itemId, name) },
      ],
    )
  }

  if (isLoading) return <LoadingScreen />

  if (!institutions?.length) {
    return <EmptyState message="No linked institutions" />
  }

  return (
    <ScrollView contentInsetAdjustmentBehavior="automatic" className="flex-1 bg-background" contentContainerClassName="gap-3 px-5 py-4">
      {error ? <ErrorBanner message={error} onDismiss={() => setError(null)} /> : null}
      {linkError ? <ErrorBanner message={linkError} onDismiss={() => setLinkError(null)} /> : null}

      {institutions.map((item) => {
        const itemAccounts = accountsByItem.get(item.itemId) ?? []
        const logo = itemAccounts[0]?.institutionLogo ?? null
        return (
          <View key={item.id} className="rounded-xl bg-surface px-4 py-2">
            <View className="flex-row items-center justify-between py-2">
              <View className="flex-1 flex-row items-center gap-3">
                {logo ? (
                  <Image source={{ uri: `data:image/png;base64,${logo}` }} style={{ width: 40, height: 40, borderRadius: 20 }} />
                ) : (
                  <View className="h-10 w-10 items-center justify-center rounded-full bg-surfaceRaised">
                    <Ionicons name="business" size={20} color={colors.textSecondary} />
                  </View>
                )}
                <View className="flex-1">
                  <Text className="font-sansMed text-base text-textPrimary">{item.institutionName}</Text>
                  {item.disabled ? (
                    <Text className="font-sans text-xs text-textMuted">Disconnected · not syncing</Text>
                  ) : null}
                </View>
              </View>
              <Pressable
                onPress={() => handleRemovePress(item.itemId, item.institutionName)}
                hitSlop={8}
                disabled={busy}
                accessibilityRole="button"
                accessibilityLabel={`Remove ${item.institutionName}`}
              >
                <Ionicons name="trash-outline" size={20} color={colors.expense} />
              </Pressable>
            </View>

            {item.disabled ? (
              // A local flag, so turning it back on needs no Link session and no new Item.
              <Pressable
                onPress={() => reconnectMutation.mutate({ itemId: item.itemId })}
                disabled={busy}
                className="border-t py-3"
                style={{ borderColor: colors.border }}
                accessibilityRole="button"
                accessibilityLabel={`Reconnect ${item.institutionName}`}
              >
                <Text className="font-sansMed text-sm text-primary">Reconnect</Text>
              </Pressable>
            ) : (
              // Update mode with account selection: adding or dropping a card reshapes the
              // existing connection instead of replacing it, so account ids — and every
              // category override and transfer link keyed to them — survive.
              <Pressable
                onPress={() => void openUpdateLink(item.itemId, { accountSelection: true })}
                disabled={busy}
                className="border-t py-3"
                style={{ borderColor: colors.border }}
                accessibilityRole="button"
                accessibilityLabel={`Manage accounts at ${item.institutionName}`}
              >
                <Text className="font-sansMed text-sm text-primary">Manage accounts</Text>
              </Pressable>
            )}

            {itemAccounts.map((account) => (
              <View
                key={account.account_id}
                className="border-t py-3"
                style={{ borderColor: colors.border }}
              >
                <Text className="font-sans text-sm text-textPrimary" numberOfLines={1}>
                  {account.name}
                </Text>
                <Text className="font-sans text-xs text-textMuted">
                  {account.mask ? `··${account.mask} · ` : ''}
                  {formatAmount(account.balances?.current ?? 0)}
                </Text>
              </View>
            ))}
          </View>
        )
      })}
    </ScrollView>
  )
}
