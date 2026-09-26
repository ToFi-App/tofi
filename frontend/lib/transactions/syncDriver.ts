import { createHeadlessApiClient } from '@/lib/api/client'
import {
  appendPendingRemovedTransactionIds,
  getCachedTransactions,
  getCursor,
  setCachedTransactions,
  setCursor,
} from '@/lib/storage/mmkv'
import { planSyncMerge, type SyncResultShape } from './planSyncMerge'
import { reportError } from '@/lib/observability/log'
import type { PlaidTransaction } from '@/types/domain'

export interface SyncItemError {
  itemId: string
  message: string
}

export type SyncResponse = SyncResultShape & { itemErrors?: SyncItemError[] }

/** The one call the driver makes. Injected so tests — and the background task, which builds its
 *  own authed client — never depend on how the default one is constructed. */
export type SyncCaller = (input: { cursors: Record<string, string> }) => Promise<SyncResponse>

export type MigrateIdsCaller = (input: { migrations: Array<{ oldId: string; newId: string }> }) => Promise<void>

export interface SyncSnapshot {
  /** Bumped after every round's MMKV writes land, and by notifyCacheMutated. Consumers key
   *  their cache re-reads off this, because those writes happen outside React. */
  completedAt: number
  isSyncing: boolean
  error: Error | null
  itemErrors: SyncItemError[]
  rateLimitedItemIds: string[]
}

export interface SyncNowOptions {
  itemIds: string[]
  accountIdToItemId: Map<string, string>
  /** Skips the cooldown. Pull-to-refresh, onboarding and background wakes are all explicit. */
  force?: boolean
  /** Maximum total sync requests in one drain sequence. */
  maxRounds?: number
  minRoundIntervalMs?: number
  /** End the sequence instead of waiting out a rate-limit backoff. For callers on a clock. */
  stopOnRateLimit?: boolean
  /**
   * Invoked after each round's writes land, with that round's raw response. Onboarding needs it
   * to sample merchant names for vendor-mapping generation — the merged cache cannot say which
   * transactions arrived in this sync. Nothing else should reach for the raw payload.
   */
  onRound?: (response: SyncResponse) => void
  call?: SyncCaller
  callMigrateIds?: MigrateIdsCaller
}

/**
 * Reuse window for an ordinary (unforced) sync. Matches the app-wide react-query staleTime, so
 * navigating between tabs reuses a recent sync exactly the way it reuses a recent query instead
 * of re-hitting Plaid on every mount.
 */
export const COOLDOWN_MS = 60_000

/**
 * Minimum gap between continuation rounds of one drain.
 *
 * This is a rate-limit budget, not a politeness delay. Plaid allows 50 /transactions/sync calls
 * per minute per Item and each round spends up to MAX_PAGES_PER_ITEM (10) of them, so rounds
 * fired back-to-back — which is what the previous implementation did, at roughly one every two
 * seconds — work out to ~300 calls/minute/item and are throttled by design. At 15s a drain uses
 * at most 40 calls/minute/item and stays inside the budget with headroom.
 *
 * Round 1 is never delayed: the feed must show new data immediately.
 */
export const MIN_ROUND_INTERVAL_MS = 15_000

/** Escalating waits for consecutive throttled rounds; the last value repeats. */
export const RATE_LIMIT_BACKOFF_MS = [30_000, 60_000, 120_000]

/** Backstop against a server that never stops reporting hasMore. 20 rounds x 10 pages x 500
 *  transactions is far beyond any real backlog. */
export const MAX_DRAIN_ROUNDS = 20

const EMPTY_SNAPSHOT: SyncSnapshot = {
  completedAt: 0,
  isSyncing: false,
  error: null,
  itemErrors: [],
  rateLimitedItemIds: [],
}

let snapshot: SyncSnapshot = EMPTY_SNAPSHOT
const listeners = new Set<() => void>()

/** The whole drain sequence. Held for its full duration — including the paced gaps — so a
 *  re-render mid-drain joins it rather than starting a second sequence on the same cursors. */
let inFlight: Promise<void> | null = null
/** What callers await: resolves once round 1 has landed and merged, while later rounds continue
 *  in the background. Pull-to-refresh must release its spinner on first data, not on full drain. */
let firstRound: Promise<void> | null = null
let resolveFirstRound: (() => void) | null = null

let lastAttemptKey: string | null = null
let lastAttemptAt = 0
let defaultCaller: SyncCaller | null = null
let defaultMigrateCaller: MigrateIdsCaller | null = null

function publish(patch: Partial<SyncSnapshot>): void {
  snapshot = { ...snapshot, ...patch }
  for (const listener of listeners) listener()
}

function itemsKey(itemIds: string[]): string {
  return [...itemIds].sort().join('|')
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function resolveCaller(explicit?: SyncCaller): SyncCaller {
  if (explicit) return explicit
  if (!defaultCaller) {
    const client = createHeadlessApiClient()
    defaultCaller = (input) => client.transactions.sync.mutate(input)
  }
  return defaultCaller
}

function resolveMigrateCaller(explicit?: MigrateIdsCaller): MigrateIdsCaller {
  if (explicit) return explicit
  if (!defaultMigrateCaller) {
    const client = createHeadlessApiClient()
    defaultMigrateCaller = (input) => client.transactions.migrateIds.mutate(input)
  }
  return defaultMigrateCaller
}

function backoffFor(consecutiveThrottles: number): number {
  return RATE_LIMIT_BACKOFF_MS[Math.min(consecutiveThrottles, RATE_LIMIT_BACKOFF_MS.length) - 1]
}

async function drain(options: SyncNowOptions): Promise<void> {
  const {
    itemIds,
    accountIdToItemId,
    maxRounds = MAX_DRAIN_ROUNDS,
    minRoundIntervalMs = MIN_ROUND_INTERVAL_MS,
    stopOnRateLimit = false,
  } = options
  const call = resolveCaller(options.call)
  publish({ isSyncing: true, error: null })

  let consecutiveThrottles = 0
  try {
    for (let round = 0; round < maxRounds; round++) {
      if (round > 0) {
        const wait = consecutiveThrottles > 0 ? backoffFor(consecutiveThrottles) : minRoundIntervalMs
        if (wait > 0) await sleep(wait)
      }

      // Read fresh, never captured: a cursor a previous round advanced past must not be resent,
      // and an omitted cursor would make Plaid re-download that item's entire history.
      const cursors: Record<string, string> = {}
      for (const itemId of itemIds) {
        const cursor = getCursor(itemId)
        if (cursor) cursors[itemId] = cursor
      }

      const response = await call({ cursors })
      const cachedByItem = new Map<string, PlaidTransaction[]>()
      for (const itemId of itemIds) cachedByItem.set(itemId, getCachedTransactions(itemId))
      const plan = planSyncMerge(response, itemIds, accountIdToItemId, cachedByItem)

      for (const [itemId, merged] of plan.mergedByItem) setCachedTransactions(itemId, merged)
      for (const [itemId, cursor] of Object.entries(plan.cursors)) setCursor(itemId, cursor)
      // Queued durably BEFORE announcing the round: Plaid emits each removal exactly once, and
      // after the merge above the transaction is gone from the cache — this queue is the only
      // remaining evidence a transfer referencing it must be dissolved (orphan sweep).
      appendPendingRemovedTransactionIds(plan.removedIds)

      if (plan.pendingToPosted.length > 0) {
        try {
          await resolveMigrateCaller(options.callMigrateIds)({ migrations: plan.pendingToPosted })
        } catch (err) {
          reportError('transaction-id-migration', err, { count: plan.pendingToPosted.length })
        }
      }

      options.onRound?.(response)

      consecutiveThrottles = plan.rateLimitedItemIds.length > 0 ? consecutiveThrottles + 1 : 0
      publish({
        completedAt: Date.now(),
        itemErrors: response.itemErrors ?? [],
        rateLimitedItemIds: plan.rateLimitedItemIds,
      })
      resolveFirstRound?.()
      resolveFirstRound = null

      if (!plan.hasMore) break
      if (stopOnRateLimit && consecutiveThrottles > 0) break
    }
  } catch (err) {
    // Never rethrown: callers await the first round only, and failures are surfaced through the
    // snapshot. Rethrowing here would surface as an unhandled rejection on the sequence promise.
    //
    // Reported as well as published, because every screen renders this as generic copy — the
    // actual message reaches no user and, without this line, no log either.
    reportError('transaction-sync', err, { itemIds: itemIds.length })
    publish({ error: err instanceof Error ? err : new Error('Sync failed.') })
  } finally {
    // Recorded even on failure, so an error can't turn a re-rendering tree into a retry storm.
    // A user pull-to-refresh still forces straight past it.
    lastAttemptKey = itemsKey(itemIds)
    lastAttemptAt = Date.now()
    publish({ isSyncing: false })
    resolveFirstRound?.()
    resolveFirstRound = null
  }
}

/**
 * The app's single owner of `transactions.sync`.
 *
 * Plaid's sync endpoint is cursor-paginated and the backend bounds each request to
 * MAX_PAGES_PER_ITEM pages, so catching up on a backlog inherently takes several requests — the
 * "drain". What this module adds is that the drain happens once, at a rate Plaid allows: six
 * mounted feed consumers used to run six independent drains against the same cursors.
 *
 * Deliberately not a hook. The background alert task runs headless with no React tree, and
 * onboarding drives a sync imperatively; all three share this one implementation.
 */
export const syncDriver = {
  subscribe(listener: () => void): () => void {
    listeners.add(listener)
    return () => void listeners.delete(listener)
  },

  getSnapshot(): SyncSnapshot {
    return snapshot
  },

  /** Announces MMKV writes made outside a sync (the cache prune) so consumers re-read. */
  notifyCacheMutated(): void {
    publish({ completedAt: Date.now() })
  },

  syncNow(options: SyncNowOptions): Promise<void> {
    if (options.itemIds.length === 0) return Promise.resolve()
    // Join rather than race: a second trigger against the same cursors would re-download the
    // same pages, and both would report the same removals.
    if (inFlight) return firstRound ?? Promise.resolve()
    if (
      !options.force &&
      itemsKey(options.itemIds) === lastAttemptKey &&
      Date.now() - lastAttemptAt < COOLDOWN_MS
    ) {
      return Promise.resolve()
    }

    firstRound = new Promise<void>((resolve) => {
      resolveFirstRound = resolve
    })
    inFlight = drain(options).finally(() => {
      inFlight = null
      firstRound = null
    })
    return firstRound
  },

  /**
   * Drops every trace of the previous session: the snapshot, the in-flight sequence and the
   * cooldown bookkeeping. Called when the signed-in user changes, alongside the MMKV clear —
   * without it the next user's first sync could be suppressed by a cooldown recorded for the
   * previous one, leaving them looking at an empty feed for up to a minute.
   */
  reset(): void {
    snapshot = EMPTY_SNAPSHOT
    listeners.clear()
    inFlight = null
    firstRound = null
    resolveFirstRound = null
    lastAttemptKey = null
    lastAttemptAt = 0
    defaultCaller = null
    defaultMigrateCaller = null
  },
}
