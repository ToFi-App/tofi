import { useMemo } from 'react'
import { buildNetWorthSeries, expectedSignFor } from '@/lib/accounts/netWorthSeries'
import type { FeedItem } from '@/lib/transactions/resolveFeed'
import type { Account } from '@/types/domain'

/**
 * What every net worth history walks from: today's signed balance per account (the anchors), the
 * accounts still linked, and the sign each balance must have — gathered in one place so every
 * history the app draws is walked from the same inputs.
 */
export function useNetWorthTrendInputs(accounts: Account[], feed: FeedItem[]) {
  const linkedAccountIds = useMemo(() => new Set(accounts.map((a) => a.account_id)), [accounts])
  const { series, anchors } = useMemo(() => buildNetWorthSeries(accounts, feed), [accounts, feed])
  const expectedSign = useMemo(() => expectedSignFor(series), [series])
  return { linkedAccountIds, series, anchors, expectedSign }
}
