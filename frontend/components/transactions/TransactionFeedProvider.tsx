import { createContext, useCallback, useEffect, useMemo, useRef, useSyncExternalStore, type ReactNode } from 'react'
import { useAccounts } from '@/hooks/useAccounts'
import { useManualTransactions } from '@/hooks/useManualTransactions'
import { useTransactionOverrides } from '@/hooks/useTransactionOverrides'
import { useVendorMappings } from '@/hooks/useVendorMappings'
import { usePlaidCategoryMappings } from '@/hooks/usePlaidCategoryMappings'
import { useCategories } from '@/hooks/useCategories'
import { useTransfers } from '@/hooks/useTransfers'
import { useTransferDismissals } from '@/hooks/useTransferDismissals'
import { useInvestmentTransactions } from '@/hooks/useInvestmentTransactions'
import { api } from '@/lib/api/client'
import {
  getCachedTransactions,
  getPendingRemovedTransactionIds,
  setCachedTransactions,
  setPendingRemovedTransactionIds,
} from '@/lib/storage/mmkv'
import { applyTransfers, mergeFeed, type FeedItem } from '@/lib/transactions/resolveFeed'
import { planCachePrune } from '@/lib/transactions/pruneOrphaned'
import { plaidItemIdsFrom } from '@/lib/financekit/mergeAccounts'
import { applyInvestmentTradeLabels, applySweepExclusion } from '@/lib/transactions/sweepExclusion'
import { isInvestmentAccount } from '@/lib/accounts/accountType'
import { aggregateMonth } from '@/lib/transactions/aggregateMonth'
import { syncDriver } from '@/lib/transactions/syncDriver'
import { reportError } from '@/lib/observability/log'
import { detectPendingPreviews, detectTransfers } from '@/lib/transfers/autoMatch'
import { findOrphanedTransfers } from '@/lib/transfers/orphanCleanup'
import type { AutoMatchResult, TransferDraft } from '@/lib/transfers/autoMatch'
import type { ActivitySecurity, Category } from '@/types/domain'

export interface TransferSuggestion extends TransferDraft {
  /**
   * 'high' drafts auto-apply (persisted as source-'auto' transfers without a tap); what
   * surfaces here is the 'medium' tier — plausible pairs that need a one-tap confirm.
   */
  confidence: 'high' | 'medium'
}

export interface TransactionFeedValue {
  feed: FeedItem[]
  categoryById: Map<string, Category>
  transferSuggestions: TransferSuggestion[]
  pendingTransferPreviews: TransferDraft[]
  spendByCategory: ReturnType<typeof aggregateMonth>['spendByCategory']
  spendByDay: ReturnType<typeof aggregateMonth>['spendByDay']
  isLoading: boolean
  error: unknown
  itemErrors: { itemId: string; message: string }[]
  refresh: () => Promise<void>
}

export const TransactionFeedContext = createContext<TransactionFeedValue | null>(null)

// Stable identity so the auto-apply effect doesn't re-fire while data is still loading.
const NO_DETECTION: AutoMatchResult = { autoApply: [], suggestions: [] }

function pairKey(draft: TransferDraft): string {
  return `${draft.expense.id}::${draft.income.id}`
}

/**
 * Single owner of the transaction feed, mounted once inside the authed tabs layout.
 *
 * Everything in here used to live in useTransactionFeed, which six screens called independently
 * — so the drain loop, the transfer detection, the auto-apply POSTs and the orphan sweep each
 * ran up to six times over identical inputs. The guards against re-entry were all component
 * refs, which is exactly what cannot work when the component is mounted more than once. Making
 * the owner singular is what fixes that class of bug rather than guarding each instance.
 *
 * The consuming hook's return shape is unchanged, so no screen had to change.
 */
export function TransactionFeedProvider({ children }: { children: ReactNode }) {
  const accounts = useAccounts()
  const manualTransactions = useManualTransactions()
  const overrides = useTransactionOverrides()
  const vendorMappings = useVendorMappings()
  const plaidCategoryMappings = usePlaidCategoryMappings()
  const categories = useCategories()
  const transfers = useTransfers()
  const dismissals = useTransferDismissals()

  // plaidItemIdsFrom, not a plain map over itemIds: Apple accounts carry the synthetic 'financekit'
  // itemId, and everything downstream of this line — the sync driver, investment transactions, the
  // cache prune, the Plaid MMKV cache — is Plaid-only and would silently misbehave on it.
  const itemIds = useMemo(() => plaidItemIdsFrom(accounts.data ?? []), [accounts.data])

  const investmentTransactions = useInvestmentTransactions(itemIds)
  const investmentAccounts = useMemo(
    () => (accounts.data ?? []).filter(isInvestmentAccount),
    [accounts.data],
  )
  const activityWindow = useMemo(() => {
    const today = new Date()
    const start = new Date(today)
    start.setUTCDate(start.getUTCDate() - 730)
    return { startDate: start.toISOString().slice(0, 10), endDate: today.toISOString().slice(0, 10) }
  }, [])
  const investmentActivityQueries = api.useQueries((t) =>
    investmentAccounts.map((account) =>
      t.investments.activity(
        { itemId: account.itemId, accountId: account.account_id, ...activityWindow },
        { staleTime: 5 * 60 * 1000, retry: 1 },
      ),
    ),
  )
  const securitiesByItem = useMemo(() => {
    const byItem = new Map<string, Map<string, ActivitySecurity>>()
    investmentActivityQueries.forEach((query, index) => {
      const itemId = investmentAccounts[index]?.itemId
      if (!itemId) return
      const securities = byItem.get(itemId) ?? new Map()
      for (const security of query.data?.securities ?? []) securities.set(security.securityId, security)
      byItem.set(itemId, securities)
    })
    return new Map([...byItem].map(([itemId, securities]) => [itemId, [...securities.values()]]))
  },
    // useQueries returns a fresh result array each render; dataUpdatedAt is the stable change signal.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [investmentAccounts, investmentActivityQueries.map((query) => query.dataUpdatedAt).join(',')],
  )

  const accountIdToItemId = useMemo(() => {
    const map = new Map<string, string>()
    for (const account of accounts.data ?? []) map.set(account.account_id, account.itemId)
    return map
  }, [accounts.data])

  // The driver's MMKV writes happen outside React, so its completedAt timestamp is what makes
  // them observable — the same trick the old local syncCompletedAt state played, moved to the
  // one place that performs the writes.
  const syncState = useSyncExternalStore(syncDriver.subscribe, syncDriver.getSnapshot)

  const liveAccountIdsByItem = useMemo(() => {
    const map = new Map<string, Set<string>>()
    for (const account of accounts.data ?? []) {
      const ids = map.get(account.itemId) ?? new Set<string>()
      ids.add(account.account_id)
      map.set(account.itemId, ids)
    }
    return map
  }, [accounts.data])

  const failedItemIds = useMemo(
    () => new Set(accounts.itemErrors.map((itemError) => itemError.itemId)),
    [accounts.itemErrors],
  )

  // Drops transactions belonging to accounts the user has stopped sharing. Update mode lets an
  // institution's account set shrink without the connection being replaced, so nothing else
  // would ever evict them — see planCachePrune, including why failed items are left alone.
  useEffect(() => {
    if (accounts.isLoading || !accounts.data) return
    const cachedByItem = new Map(itemIds.map((itemId) => [itemId, getCachedTransactions(itemId)]))
    const plan = planCachePrune({ itemIds, cachedByItem, liveAccountIdsByItem, failedItemIds })
    if (plan.size === 0) return
    for (const [itemId, kept] of plan) setCachedTransactions(itemId, kept)
    syncDriver.notifyCacheMutated()
  }, [accounts.isLoading, accounts.data, itemIds, liveAccountIdsByItem, failedItemIds])

  // Cursor discipline, pacing, dedupe and rate-limit backoff all live in the driver; this is
  // only the trigger. An unforced call inside the cooldown is a no-op, so remounts are free.
  useEffect(() => {
    void syncDriver.syncNow({ itemIds, accountIdToItemId })
  }, [itemIds, accountIdToItemId])

  const plaidTransactions = useMemo(
    () => itemIds.flatMap((itemId) => getCachedTransactions(itemId)),
    // Re-derive whenever a sync round completes, since MMKV writes happen as a side effect
    // of the driver rather than through React state.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [itemIds, syncState.completedAt],
  )

  // Apple Card rows arrive already Plaid-shaped, carrying a PFC crosswalked from their MCC, so the
  // whole chain below — resolveCategory, transfer auto-match, aggregateMonth, the sweep exclusion —
  // treats them as ordinary card transactions. Unlike the Plaid arrays these come through React
  // state (useFinanceKit owns the read), so no completedAt trick is needed.
  const rawTransactions = useMemo(
    () => [...plaidTransactions, ...accounts.financeKitTransactions],
    [plaidTransactions, accounts.financeKitTransactions],
  )

  // plaidCategoryMappings is gated alongside the others rather than defaulted to []: resolving
  // with an empty mapping list would render a feed full of Uncategorized rows, then re-render
  // them categorized once the query lands. Better to hold the feed empty for one tick.
  const feed = useMemo(() => {
    if (!manualTransactions.data || !overrides.data || !vendorMappings.data || !plaidCategoryMappings.data) return []
    const merged = mergeFeed(
      rawTransactions,
      manualTransactions.data,
      overrides.data,
      vendorMappings.data,
      plaidCategoryMappings.data,
      // Drives isBrokerageCashAccount, which scopes the sweep exclusion in totals.ts. Not gated
      // above: with accounts still loading there are no cached transactions to classify either,
      // since itemIds comes from the same query.
      accounts.data ?? [],
      investmentTransactions.transactions,
    )
    const withTransfers = applyTransfers(merged, transfers.data ?? [])
    // Investment security names/tickers identify trade cash movements by their own descriptions.
    // Sweep exclusion runs last and only touches still-unpaired brokerage-cash outflows.
    const withInvestmentLabels = applyInvestmentTradeLabels(withTransfers, securitiesByItem, accountIdToItemId)
    const result = applySweepExclusion(withInvestmentLabels)
    return result
  }, [
    rawTransactions,
    plaidTransactions,
    accounts.financeKitTransactions,
    manualTransactions.data,
    overrides.data,
    vendorMappings.data,
    plaidCategoryMappings.data,
    accounts.data,
    investmentTransactions.transactions,
    securitiesByItem,
    accountIdToItemId,
    transfers.data,
  ])

  const categoryById = useMemo(() => new Map((categories.data ?? []).map((c) => [c.id, c])), [categories.data])

  // Delegates to the shared aggregator rather than recomputing inline, so these numbers
  // can never drift from what Dashboard, Budgets and the Transactions calendar show.
  const aggregate = useMemo(() => aggregateMonth(feed), [feed])

  // Automatic internal-transfer detection over the FULL cache, not just the sync delta
  // (docs/credit-card-payment-auto-transfer.md). Full-cache detection is what makes the
  // account-link scan automatic — a newly linked account's history lands in the cache via
  // sync and the next pass pairs it against everything, old or new, whichever leg carries
  // the tag — and it closes the cross-session gap where the tagged leg synced in an earlier
  // session and delta-only driving would never revisit it. Cost is fine: the index build is
  // O(eligible) either way and drivers are pre-filtered to transfer-tagged items.
  //
  // The gate on loaded data is load-bearing: detecting before transfers/dismissals
  // arrive would see already-linked legs as unlinked and re-create them
  // (the DB's partial-unique indexes are the backstop, but don't lean on the backstop).
  const detection = useMemo<AutoMatchResult>(() => {
    if (feed.length === 0 || !accounts.data?.length) return NO_DETECTION
    if (!transfers.data || !dismissals.data) return NO_DETECTION
    const dismissedIds = new Set(dismissals.data.map((d) => d.expensePlaidTransactionId))
    return detectTransfers({ feed, accounts: accounts.data, dismissedIds })
  }, [feed, accounts.data, transfers.data, dismissals.data])

  // AUTO-APPLY: persist high-confidence drafts as source-'auto' transfers. postedPairsRef
  // stops re-posting the same pair while the transfers.list invalidation is in flight
  // (fresh list data re-stamps the legs and detection stops producing the draft). A pair
  // whose POST fails stays counted and is retried next session — the safe direction.
  const postedPairsRef = useRef(new Set<string>())
  const createManyTransfers = transfers.createMany
  useEffect(() => {
    const fresh = detection.autoApply.filter((draft) => !postedPairsRef.current.has(pairKey(draft)))
    if (fresh.length === 0) return
    for (const draft of fresh) postedPairsRef.current.add(pairKey(draft))
    const rows = fresh.map((draft) => ({
      kind: draft.kind,
      expensePlaidTransactionId: draft.expense.id,
      incomePlaidTransactionId: draft.income.id,
      amount: draft.amount.toFixed(2),
    }))
    void (async () => {
      // Chunked to the router's batch bound; sequential so a backfill can't stampede.
      for (let i = 0; i < rows.length; i += 100) {
        try {
          await createManyTransfers({ transfers: rows.slice(i, i + 100) })
        } catch (err) {
          // Best-effort by design: the pairs stay counted (never wrongly hidden) and the
          // next app session re-detects and retries them. Count only — the drafts themselves
          // are amounts and merchant names.
          reportError('transfer-auto-apply', err, { pairCount: rows.length })
          break
        }
      }
    })()
  }, [detection, createManyTransfers])

  // The medium tier: plausible pairs that need a one-tap confirm, never auto-persisted.
  const transferSuggestions = useMemo<TransferSuggestion[]>(
    () => detection.suggestions.map((draft) => ({ ...draft, confidence: 'medium' as const })),
    [detection],
  )

  // Pairs whose legs haven't all posted yet — informational only, never confirmable. Surfaced
  // so a transfer visibly sitting in the feed reads as "matching once posted" rather than as
  // detection silently failing during the banks' 1-3 day posting window.
  const pendingTransferPreviews = useMemo<TransferDraft[]>(() => {
    if (feed.length === 0 || !accounts.data?.length || !dismissals.data) return []
    const dismissedIds = new Set(dismissals.data.map((d) => d.expensePlaidTransactionId))
    const previews = detectPendingPreviews({ feed, accounts: accounts.data, dismissedIds })
    // A posted leg can appear in a REAL draft (posted counterpart) and a preview (pending
    // counterpart of the same amount) at once. The real draft wins — the confirmable row is
    // actionable now, and a second row claiming the same transaction would read as two
    // different transfers.
    const claimed = new Set(
      [...detection.autoApply, ...detection.suggestions].flatMap((d) => [d.expense.id, d.income.id]),
    )
    return previews.filter((p) => !claimed.has(p.expense.id) && !claimed.has(p.income.id))
  }, [feed, accounts.data, dismissals.data, detection])

  // ORPHAN SWEEP (phase 6): dissolve transfers whose leg Plaid retracted (queued durably by the
  // driver) or whose auto-paired amounts drifted after a `modified`. Deleting goes through
  // transfers.delete, NOT unmark — no dismissal is written, because the pair wasn't rejected by
  // the user, it ceased to exist; a corrected re-post must be free to re-match.
  // Convergence: a queued id stays until no transfer references it, which only becomes true
  // through the refetched list after a successful delete — so a failed delete retries on the
  // next pass instead of being lost.
  const orphanSweepBusyRef = useRef(false)
  const deleteTransfer = transfers.delete
  useEffect(() => {
    if (!transfers.data) return
    const pendingRemovedIds = getPendingRemovedTransactionIds()
    const feedById = new Map(feed.map((item) => [item.id, item]))
    const { dissolveTransferIds, clearableRemovedIds } = findOrphanedTransfers({
      transfers: transfers.data,
      feedById,
      pendingRemovedIds,
    })
    if (clearableRemovedIds.length > 0) {
      const clearable = new Set(clearableRemovedIds)
      setPendingRemovedTransactionIds(pendingRemovedIds.filter((id) => !clearable.has(id)))
    }
    if (dissolveTransferIds.length === 0 || orphanSweepBusyRef.current) return
    orphanSweepBusyRef.current = true
    void (async () => {
      try {
        for (const id of dissolveTransferIds) {
          try {
            await deleteTransfer({ id })
          } catch (err) {
            // Leave the queue untouched; the next pass retries this transfer.
            reportError('transfer-orphan-sweep', err, { transferId: id })
          }
        }
      } finally {
        orphanSweepBusyRef.current = false
      }
    })()
  }, [feed, transfers.data, deleteTransfer])

  // Memoized so pull-to-refresh consumers (usePullToRefresh) don't rebuild their
  // RefreshControl on every feed render. force: the user asked, so the cooldown does not apply.
  // Both sources, in parallel: the user pulling to refresh means "make everything current", and a
  // FinanceKit read is local and cheap. Promise.all rather than sequential so a slow Plaid round
  // trip does not delay the Apple Card rows. Both swallow their own failures onto their snapshots,
  // so neither can reject this.
  const refresh = useCallback(
    async () => {
      await Promise.all([
        syncDriver.syncNow({ itemIds, accountIdToItemId, force: true }),
        accounts.syncFinanceKit(),
      ])
    },
    [itemIds, accountIdToItemId, accounts.syncFinanceKit],
  )

  const value = useMemo<TransactionFeedValue>(
    () => ({
      feed,
      categoryById,
      transferSuggestions,
      pendingTransferPreviews,
      spendByCategory: aggregate.spendByCategory,
      spendByDay: aggregate.spendByDay,
      isLoading:
        accounts.isLoading ||
        manualTransactions.isLoading ||
        overrides.isLoading ||
        vendorMappings.isLoading ||
        plaidCategoryMappings.isLoading ||
        categories.isLoading ||
        // The sync blocks first paint only when there is nothing cached to paint — a first run
        // (or fresh install) has no transactions until the initial sync lands. Every later open
        // renders the MMKV cache immediately and lets the sync land in the background; the feed
        // re-derives off the driver's completedAt when it does.
        (syncState.isSyncing && rawTransactions.length === 0),
      error:
        accounts.error ??
        manualTransactions.error ??
        overrides.error ??
        vendorMappings.error ??
        plaidCategoryMappings.error ??
        categories.error ??
        syncState.error,
      // MUST NOT be rendered as-is. The investments endpoint is called for every linked item
      // regardless of whether its institution supports the product, so every user with a plain
      // bank carries a permanent PRODUCTS_NOT_SUPPORTED entry here that means nothing to them.
      // The array is kept because the sync errors in it are genuinely diagnostic; any UI that
      // surfaces it must first filter down to the codes that are actionable for the user.
      itemErrors: [...syncState.itemErrors, ...investmentTransactions.itemErrors],
      refresh,
    }),
    [
      feed,
      categoryById,
      transferSuggestions,
      pendingTransferPreviews,
      aggregate,
      accounts.isLoading,
      accounts.error,
      manualTransactions.isLoading,
      manualTransactions.error,
      overrides.isLoading,
      overrides.error,
      vendorMappings.isLoading,
      vendorMappings.error,
      plaidCategoryMappings.isLoading,
      plaidCategoryMappings.error,
      categories.isLoading,
      categories.error,
      syncState,
      rawTransactions.length,
      investmentTransactions.itemErrors,
      refresh,
    ],
  )

  return <TransactionFeedContext.Provider value={value}>{children}</TransactionFeedContext.Provider>
}
