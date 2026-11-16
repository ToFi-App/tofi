import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { PlaidTransaction } from '@/types/domain'

// The real module reads EXPO_PUBLIC_API_URL and pulls in Supabase at import time; every test
// injects its own caller, so the default is never built.
vi.mock('@/lib/api/client', () => ({ createHeadlessApiClient: () => { throw new Error('not used in tests') } }))

const cursors = new Map<string, string>()
const cached = new Map<string, PlaidTransaction[]>()
let removedQueue: string[] = []
let migrationQueue: Array<{ oldId: string; newId: string }> = []

vi.mock('@/lib/storage/mmkv', () => ({
  getCursor: (itemId: string) => cursors.get(itemId),
  setCursor: (itemId: string, cursor: string) => void cursors.set(itemId, cursor),
  getCachedTransactions: (itemId: string) => cached.get(itemId) ?? [],
  setCachedTransactions: (itemId: string, txns: PlaidTransaction[]) => void cached.set(itemId, txns),
  appendPendingRemovedTransactionIds: (ids: string[]) => void (removedQueue = [...removedQueue, ...ids]),
  getPendingIdMigrations: () => migrationQueue,
  setPendingIdMigrations: (m: Array<{ oldId: string; newId: string }>) => void (migrationQueue = m),
}))

const ACCOUNT_TO_ITEM = new Map([['acc-1', 'item-1']])
const ITEMS = ['item-1']

function txn(transaction_id: string, account_id = 'acc-1'): PlaidTransaction {
  return { transaction_id, account_id, amount: 10 } as PlaidTransaction
}

function response(overrides: Record<string, unknown> = {}) {
  return {
    added: [],
    modified: [],
    removed: [],
    cursors: {},
    hasMore: {},
    rateLimited: {},
    itemErrors: [],
    ...overrides,
  }
}

async function importDriver() {
  return await import('./syncDriver')
}

describe('syncDriver', () => {
  beforeEach(async () => {
    vi.useFakeTimers()
    cursors.clear()
    cached.clear()
    removedQueue = []
    migrationQueue = []
    const { syncDriver } = await importDriver()
    syncDriver.reset()
  })

  afterEach(() => vi.useRealTimers())

  it('collapses concurrent callers into a single request', async () => {
    const { syncDriver } = await importDriver()
    const call = vi.fn().mockResolvedValue(response())

    // Six mounted consumers triggering on the same render pass — the case that made the log
    // show three transactions.sync calls per batched POST.
    const promises = Array.from({ length: 6 }, () => syncDriver.syncNow({ itemIds: ITEMS, accountIdToItemId: ACCOUNT_TO_ITEM, call }))
    await vi.advanceTimersByTimeAsync(0)
    await Promise.all(promises)

    expect(call).toHaveBeenCalledTimes(1)
  })

  it('suppresses a repeat sync inside the cooldown but never a forced one', async () => {
    const { syncDriver } = await importDriver()
    const call = vi.fn().mockResolvedValue(response())
    const args = { itemIds: ITEMS, accountIdToItemId: ACCOUNT_TO_ITEM, call }

    await syncDriver.syncNow(args)
    await vi.advanceTimersByTimeAsync(0)
    expect(call).toHaveBeenCalledTimes(1)

    // Tab navigation remounting a consumer 5s later must not re-hit Plaid.
    await vi.advanceTimersByTimeAsync(5_000)
    await syncDriver.syncNow(args)
    expect(call).toHaveBeenCalledTimes(1)

    // Pull-to-refresh is an explicit user request and always goes through.
    await syncDriver.syncNow({ ...args, force: true })
    await vi.advanceTimersByTimeAsync(0)
    expect(call).toHaveBeenCalledTimes(2)

    // Past the cooldown an ordinary trigger syncs again.
    await vi.advanceTimersByTimeAsync(61_000)
    await syncDriver.syncNow(args)
    await vi.advanceTimersByTimeAsync(0)
    expect(call).toHaveBeenCalledTimes(3)
  })

  it('bypasses the cooldown when the set of linked items changes', async () => {
    const { syncDriver } = await importDriver()
    const call = vi.fn().mockResolvedValue(response())

    await syncDriver.syncNow({ itemIds: ITEMS, accountIdToItemId: ACCOUNT_TO_ITEM, call })
    await vi.advanceTimersByTimeAsync(0)
    // Linking an institution must sync immediately, cooldown or not.
    await syncDriver.syncNow({ itemIds: ['item-1', 'item-2'], accountIdToItemId: ACCOUNT_TO_ITEM, call })
    await vi.advanceTimersByTimeAsync(0)

    expect(call).toHaveBeenCalledTimes(2)
  })

  it('paces continuation rounds so per-item Plaid calls stay under the limit', async () => {
    const { syncDriver, MIN_ROUND_INTERVAL_MS } = await importDriver()
    const call = vi
      .fn()
      .mockResolvedValueOnce(response({ cursors: { 'item-1': 'c1' }, hasMore: { 'item-1': true } }))
      .mockResolvedValueOnce(response({ cursors: { 'item-1': 'c2' }, hasMore: { 'item-1': false } }))

    await syncDriver.syncNow({ itemIds: ITEMS, accountIdToItemId: ACCOUNT_TO_ITEM, call })
    // Round 1 is never delayed — the feed must not wait to show anything.
    expect(call).toHaveBeenCalledTimes(1)

    await vi.advanceTimersByTimeAsync(MIN_ROUND_INTERVAL_MS - 1)
    expect(call).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(1)
    expect(call).toHaveBeenCalledTimes(2)
  })

  it('resolves the caller after the first round rather than the whole drain', async () => {
    const { syncDriver } = await importDriver()
    const call = vi.fn().mockResolvedValue(response({ cursors: { 'item-1': 'c1' }, hasMore: { 'item-1': true } }))

    let settled = false
    void syncDriver.syncNow({ itemIds: ITEMS, accountIdToItemId: ACCOUNT_TO_ITEM, call }).then(() => (settled = true))
    await vi.advanceTimersByTimeAsync(0)

    // Pull-to-refresh must release its spinner once data has landed, not after a full backfill.
    expect(settled).toBe(true)
    expect(call).toHaveBeenCalledTimes(1)
  })

  it('re-reads cursors from storage between rounds instead of reusing captured ones', async () => {
    const { syncDriver, MIN_ROUND_INTERVAL_MS } = await importDriver()
    const call = vi
      .fn()
      .mockResolvedValueOnce(response({ cursors: { 'item-1': 'c1' }, hasMore: { 'item-1': true } }))
      .mockResolvedValueOnce(response({ cursors: { 'item-1': 'c2' }, hasMore: { 'item-1': false } }))

    await syncDriver.syncNow({ itemIds: ITEMS, accountIdToItemId: ACCOUNT_TO_ITEM, call })
    await vi.advanceTimersByTimeAsync(MIN_ROUND_INTERVAL_MS)

    expect(call.mock.calls.map((c) => c[0])).toEqual([{ cursors: {} }, { cursors: { 'item-1': 'c1' } }])
  })

  it('backs off harder each consecutive rate-limited round, and recovers after a clean one', async () => {
    const { syncDriver, MIN_ROUND_INTERVAL_MS, RATE_LIMIT_BACKOFF_MS } = await importDriver()
    const limited = response({ cursors: { 'item-1': 'c1' }, hasMore: { 'item-1': true }, rateLimited: { 'item-1': true } })
    const call = vi
      .fn()
      .mockResolvedValueOnce(limited)
      .mockResolvedValueOnce(limited)
      .mockResolvedValueOnce(response({ cursors: { 'item-1': 'c2' }, hasMore: { 'item-1': true } }))
      .mockResolvedValueOnce(response({ hasMore: { 'item-1': false } }))

    await syncDriver.syncNow({ itemIds: ITEMS, accountIdToItemId: ACCOUNT_TO_ITEM, call })
    expect(call).toHaveBeenCalledTimes(1)

    // Normal pacing is not enough when Plaid has already said no.
    await vi.advanceTimersByTimeAsync(MIN_ROUND_INTERVAL_MS)
    expect(call).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(RATE_LIMIT_BACKOFF_MS[0] - MIN_ROUND_INTERVAL_MS)
    expect(call).toHaveBeenCalledTimes(2)

    // Second consecutive throttle escalates.
    await vi.advanceTimersByTimeAsync(RATE_LIMIT_BACKOFF_MS[0])
    expect(call).toHaveBeenCalledTimes(2)
    await vi.advanceTimersByTimeAsync(RATE_LIMIT_BACKOFF_MS[1] - RATE_LIMIT_BACKOFF_MS[0])
    expect(call).toHaveBeenCalledTimes(3)

    // A clean round resets the escalation back to ordinary pacing.
    await vi.advanceTimersByTimeAsync(MIN_ROUND_INTERVAL_MS)
    expect(call).toHaveBeenCalledTimes(4)
  })

  it('publishes rate-limited item ids without reporting them as item errors', async () => {
    const { syncDriver } = await importDriver()
    const call = vi.fn().mockResolvedValue(response({ hasMore: { 'item-1': false }, rateLimited: { 'item-1': true } }))

    await syncDriver.syncNow({ itemIds: ITEMS, accountIdToItemId: ACCOUNT_TO_ITEM, call })
    await vi.advanceTimersByTimeAsync(0)

    expect(syncDriver.getSnapshot().rateLimitedItemIds).toEqual(['item-1'])
    expect(syncDriver.getSnapshot().itemErrors).toEqual([])
  })

  it('stops at the round cap even if the server never stops reporting hasMore', async () => {
    const { syncDriver, MIN_ROUND_INTERVAL_MS } = await importDriver()
    const call = vi.fn().mockResolvedValue(response({ cursors: { 'item-1': 'c' }, hasMore: { 'item-1': true } }))

    await syncDriver.syncNow({ itemIds: ITEMS, accountIdToItemId: ACCOUNT_TO_ITEM, call, maxRounds: 3 })
    await vi.advanceTimersByTimeAsync(MIN_ROUND_INTERVAL_MS * 10)

    expect(call).toHaveBeenCalledTimes(3)
  })

  it('runs unpaced and gives up on a throttle when the caller is a background wake', async () => {
    const { syncDriver } = await importDriver()
    const call = vi
      .fn()
      .mockResolvedValueOnce(response({ cursors: { 'item-1': 'c1' }, hasMore: { 'item-1': true } }))
      .mockResolvedValueOnce(response({ cursors: { 'item-1': 'c2' }, hasMore: { 'item-1': true }, rateLimited: { 'item-1': true } }))
      .mockResolvedValue(response())

    // iOS grants ~30s: pacing would spend the whole window asleep, and a 30s+ rate-limit
    // backoff could never complete, so the wake stops and the next one resumes.
    await syncDriver.syncNow({
      itemIds: ITEMS,
      accountIdToItemId: ACCOUNT_TO_ITEM,
      call,
      force: true,
      maxRounds: 4,
      minRoundIntervalMs: 0,
      stopOnRateLimit: true,
    })
    await vi.advanceTimersByTimeAsync(0)

    expect(call).toHaveBeenCalledTimes(2)
  })

  it('merges each round into storage and queues removals before announcing completion', async () => {
    const { syncDriver } = await importDriver()
    cached.set('item-1', [txn('t1')])
    const seen: number[] = []
    const call = vi.fn().mockResolvedValue(
      response({
        added: [txn('t2')],
        removed: [{ transaction_id: 't1' }],
        cursors: { 'item-1': 'c1' },
        hasMore: { 'item-1': false },
      }),
    )

    // A subscriber must never observe a completedAt bump before the writes it describes.
    const unsubscribe = syncDriver.subscribe(() => seen.push(cached.get('item-1')?.length ?? -1))
    await syncDriver.syncNow({ itemIds: ITEMS, accountIdToItemId: ACCOUNT_TO_ITEM, call })
    await vi.advanceTimersByTimeAsync(0)
    unsubscribe()

    expect(cached.get('item-1')?.map((t) => t.transaction_id)).toEqual(['t2'])
    expect(cursors.get('item-1')).toBe('c1')
    expect(removedQueue).toEqual(['t1'])
    expect(seen.every((count) => count === 1)).toBe(true)
    expect(syncDriver.getSnapshot().completedAt).toBeGreaterThan(0)
  })

  it('records a failed request, releases the in-flight lock and resolves its callers', async () => {
    const { syncDriver } = await importDriver()
    const call = vi.fn().mockRejectedValue(new Error('network down'))
    // Every screen renders a sync failure as generic copy, so the report is the only place the
    // real message survives.
    const reported = vi.spyOn(console, 'error').mockImplementation(() => {})

    // Callers must not have to catch: today's triggerSync swallows too, since failures
    // surface through the snapshot instead.
    await expect(syncDriver.syncNow({ itemIds: ITEMS, accountIdToItemId: ACCOUNT_TO_ITEM, call })).resolves.toBeUndefined()
    await vi.advanceTimersByTimeAsync(0)

    expect(syncDriver.getSnapshot().error).toBeInstanceOf(Error)
    expect(syncDriver.getSnapshot().isSyncing).toBe(false)
    expect(reported.mock.calls[0][0]).toBe('[transaction-sync] network down')
    reported.mockRestore()

    // The lock is released, so a forced retry is possible immediately.
    const ok = vi.fn().mockResolvedValue(response())
    await syncDriver.syncNow({ itemIds: ITEMS, accountIdToItemId: ACCOUNT_TO_ITEM, call: ok, force: true })
    await vi.advanceTimersByTimeAsync(0)
    expect(ok).toHaveBeenCalledTimes(1)
    expect(syncDriver.getSnapshot().error).toBeNull()
  })

  it('does nothing when there are no linked items', async () => {
    const { syncDriver } = await importDriver()
    const call = vi.fn().mockResolvedValue(response())

    await syncDriver.syncNow({ itemIds: [], accountIdToItemId: ACCOUNT_TO_ITEM, call })
    await vi.advanceTimersByTimeAsync(0)

    expect(call).not.toHaveBeenCalled()
  })

  it('keeps a stable snapshot identity until something changes', async () => {
    const { syncDriver } = await importDriver()
    // useSyncExternalStore re-renders on every getSnapshot identity change, so an unchanged
    // snapshot must be the same object.
    const first = syncDriver.getSnapshot()
    expect(syncDriver.getSnapshot()).toBe(first)

    syncDriver.notifyCacheMutated()
    expect(syncDriver.getSnapshot()).not.toBe(first)
  })

  it('hands each round\'s raw response to onRound for callers that need the payload', async () => {
    const { syncDriver, MIN_ROUND_INTERVAL_MS } = await importDriver()
    const call = vi
      .fn()
      .mockResolvedValueOnce(response({ added: [txn('t1')], cursors: { 'item-1': 'c1' }, hasMore: { 'item-1': true } }))
      .mockResolvedValueOnce(response({ added: [txn('t2')], hasMore: { 'item-1': false } }))
    const seen: string[] = []

    // Onboarding samples merchants out of the payload to seed vendor mappings; the merged
    // cache alone cannot tell it which transactions arrived in this sync.
    await syncDriver.syncNow({
      itemIds: ITEMS,
      accountIdToItemId: ACCOUNT_TO_ITEM,
      call,
      onRound: (r) => seen.push(...r.added.map((t) => t.transaction_id)),
    })
    expect(seen).toEqual(['t1'])
    await vi.advanceTimersByTimeAsync(MIN_ROUND_INTERVAL_MS)
    expect(seen).toEqual(['t1', 't2'])
  })


  it('clears the cooldown on reset so a new session syncs immediately', async () => {
    const { syncDriver } = await importDriver()
    const call = vi.fn().mockResolvedValue(response())
    const args = { itemIds: ITEMS, accountIdToItemId: ACCOUNT_TO_ITEM, call }

    await syncDriver.syncNow(args)
    await vi.advanceTimersByTimeAsync(0)
    // Signing out and back in wipes the MMKV cache; a surviving cooldown would leave the
    // returning user staring at an empty feed until it expired.
    syncDriver.reset()
    await syncDriver.syncNow(args)
    await vi.advanceTimersByTimeAsync(0)

    expect(call).toHaveBeenCalledTimes(2)
  })

  describe('pending transactions that settle', () => {
    const settled = () =>
      response({
        added: [{ ...txn('posted-1'), pending_transaction_id: 'pending-1' } as PlaidTransaction],
        removed: [{ transaction_id: 'pending-1' }, { transaction_id: 'gone-1' }],
        cursors: { 'item-1': 'c1' },
        hasMore: { 'item-1': false },
      })

    it('keeps a settled pending id out of the orphan sweep queue and migrates it instead', async () => {
      const { syncDriver } = await importDriver()
      cached.set('item-1', [{ ...txn('pending-1'), pending: true } as PlaidTransaction, txn('gone-1')])
      const callMigrateIds = vi.fn().mockResolvedValue(undefined)
      const migrated = vi.fn()
      const unsubscribe = syncDriver.onIdsMigrated(migrated)

      await syncDriver.syncNow({ itemIds: ITEMS, accountIdToItemId: ACCOUNT_TO_ITEM, call: vi.fn().mockResolvedValue(settled()), callMigrateIds })
      await vi.advanceTimersByTimeAsync(0)
      unsubscribe()

      // Only the genuine retraction may reach the sweep; the settled id would get its
      // freshly repointed transfer deleted.
      expect(removedQueue).toEqual(['gone-1'])
      expect(callMigrateIds).toHaveBeenCalledWith({ migrations: [{ oldId: 'pending-1', newId: 'posted-1' }] })
      expect(migrationQueue).toEqual([])
      expect(migrated).toHaveBeenCalledWith([{ oldId: 'pending-1', newId: 'posted-1' }])
    })

    it('tells listeners before announcing the round, so caches refetch before the feed re-renders', async () => {
      const { syncDriver } = await importDriver()
      const order: string[] = []
      const unMigrated = syncDriver.onIdsMigrated(() => order.push('migrated'))
      const unsubscribe = syncDriver.subscribe(() => {
        if (syncDriver.getSnapshot().completedAt > 0 && !order.includes('round')) order.push('round')
      })

      await syncDriver.syncNow({
        itemIds: ITEMS,
        accountIdToItemId: ACCOUNT_TO_ITEM,
        call: vi.fn().mockResolvedValue(settled()),
        callMigrateIds: vi.fn().mockResolvedValue(undefined),
      })
      await vi.advanceTimersByTimeAsync(0)
      unMigrated()
      unsubscribe()

      expect(order).toEqual(['migrated', 'round'])
    })

    it('keeps a failed migration queued and retries it on the next sync, never sweeping it', async () => {
      const { syncDriver } = await importDriver()
      const callMigrateIds = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValue(undefined)
      const migrated = vi.fn()
      const unsubscribe = syncDriver.onIdsMigrated(migrated)

      await syncDriver.syncNow({ itemIds: ITEMS, accountIdToItemId: ACCOUNT_TO_ITEM, call: vi.fn().mockResolvedValue(settled()), callMigrateIds })
      await vi.advanceTimersByTimeAsync(0)

      expect(migrationQueue).toEqual([{ oldId: 'pending-1', newId: 'posted-1' }])
      expect(removedQueue).toEqual(['gone-1'])
      expect(migrated).not.toHaveBeenCalled()

      await syncDriver.syncNow({ itemIds: ITEMS, accountIdToItemId: ACCOUNT_TO_ITEM, force: true, call: vi.fn().mockResolvedValue(response()), callMigrateIds })
      await vi.advanceTimersByTimeAsync(0)
      unsubscribe()

      expect(callMigrateIds).toHaveBeenCalledTimes(2)
      expect(migrationQueue).toEqual([])
      expect(migrated).toHaveBeenCalledTimes(1)
    })
  })
})
