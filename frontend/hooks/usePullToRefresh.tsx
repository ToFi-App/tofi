import { useCallback, useMemo, useState } from 'react'
import { RefreshControl } from 'react-native'
import { api } from '@/lib/api/client'
import { colors } from '@/constants/theme'
import { haptics } from '@/lib/ui/haptics'

/**
 * Wires a pull-down gesture to a full data refresh: re-runs the Plaid transaction sync
 * (via the feed's `refresh`, which coalesces overlapping syncs into one in-flight promise)
 * and refetches accounts — balances live on accounts.list, which the sync doesn't touch.
 *
 * Returns a ready-to-mount element for the scrollable's `refreshControl` prop; the spinner
 * stays up until both the sync round and the accounts refetch have settled.
 */
export function usePullToRefresh(refresh: () => Promise<void>) {
  const utils = api.useUtils()
  const [refreshing, setRefreshing] = useState(false)

  const onRefresh = useCallback(async () => {
    // The pull has passed the point where it refreshes: a tap marks the catch, as in Mail.
    haptics.tap()
    setRefreshing(true)
    try {
      await Promise.all([refresh(), utils.accounts.list.invalidate()])
    } finally {
      setRefreshing(false)
    }
  }, [refresh, utils])

  return useMemo(
    () => <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />,
    [refreshing, onRefresh],
  )
}
