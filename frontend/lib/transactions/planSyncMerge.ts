import type { PlaidTransaction } from '@/types/domain'

export interface SyncResultShape {
  added: PlaidTransaction[]
  modified: PlaidTransaction[]
  removed: { transaction_id: string }[]
  cursors: Record<string, string>
  hasMore?: Record<string, boolean>
  rateLimited?: Record<string, true>
}

export interface SyncMergePlan {
  /** Every item's full post-merge transaction list, ready to write back to the cache. */
  mergedByItem: Map<string, PlaidTransaction[]>
  /** Cursor writes to persist, exactly as the server reported them. */
  cursors: Record<string, string>
  /** Removal ids to queue durably for the orphaned-transfer sweep. */
  removedIds: string[]
  /** True when any item has more pages to drain. */
  hasMore: boolean
  /**
   * Items Plaid throttled us on. These also count towards `hasMore`, so the flag is not about
   * whether to keep draining but about how long to wait first — see syncDriver's backoff.
   */
  rateLimitedItemIds: string[]
  /**
   * Pending-to-posted ID migrations: when a pending transaction settles, Plaid removes the
   * pending ID and adds a new posted transaction whose `pending_transaction_id` points back.
   * Overrides and transfer legs keyed on the old ID must be repointed to survive settlement.
   */
  pendingToPosted: Array<{ oldId: string; newId: string }>
}

/**
 * Pure merge step of a transactions sync: fold a sync response into the per-item caches.
 * Extracted from useTransactionFeed so the background alert task applies a sync exactly the
 * way the foreground app does — same removal/modify semantics, same idempotency.
 *
 * Keyed by transaction_id so the merge is idempotent: re-running with the same payload
 * (retry, double invocation) overwrites rather than duplicating.
 */
export function planSyncMerge(
  result: SyncResultShape,
  itemIds: string[],
  accountIdToItemId: Map<string, string>,
  cachedByItem: Map<string, PlaidTransaction[]>,
): SyncMergePlan {
  const removedIds = new Set(result.removed.map((r) => r.transaction_id))
  const modifiedIds = new Set(result.modified.map((t) => t.transaction_id))

  const mergedMaps = new Map<string, Map<string, PlaidTransaction>>()
  for (const itemId of itemIds) {
    const map = new Map<string, PlaidTransaction>()
    for (const txn of cachedByItem.get(itemId) ?? []) {
      if (removedIds.has(txn.transaction_id) || modifiedIds.has(txn.transaction_id)) continue
      map.set(txn.transaction_id, txn)
    }
    mergedMaps.set(itemId, map)
  }

  for (const txn of [...result.added, ...result.modified]) {
    const itemId = accountIdToItemId.get(txn.account_id)
    if (!itemId) continue
    const map = mergedMaps.get(itemId) ?? new Map<string, PlaidTransaction>()
    map.set(txn.transaction_id, txn)
    mergedMaps.set(itemId, map)
  }

  const mergedByItem = new Map<string, PlaidTransaction[]>()
  for (const [itemId, map] of mergedMaps) mergedByItem.set(itemId, Array.from(map.values()))

  const pendingToPosted: Array<{ oldId: string; newId: string }> = []
  for (const txn of result.added) {
    if (txn.pending_transaction_id && removedIds.has(txn.pending_transaction_id)) {
      pendingToPosted.push({ oldId: txn.pending_transaction_id, newId: txn.transaction_id })
    }
  }

  return {
    mergedByItem,
    cursors: result.cursors,
    removedIds: result.removed.map((r) => r.transaction_id),
    hasMore: Object.values(result.hasMore ?? {}).some(Boolean),
    rateLimitedItemIds: Object.keys(result.rateLimited ?? {}),
    pendingToPosted,
  }
}
