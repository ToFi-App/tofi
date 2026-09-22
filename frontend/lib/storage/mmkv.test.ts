import { beforeEach, describe, expect, it, vi } from 'vitest'

// The backing store lives on globalThis rather than inside the class so it survives the
// vi.resetModules() each test does. Tests that need to observe module-load side effects — the
// legacy-cache purge below — have to seed it BEFORE importing the module under test.
type MmkvStore = Map<string, string | number>
const globalWithStore = globalThis as unknown as { __mmkvStore?: MmkvStore }
const backing: MmkvStore = new Map()
globalWithStore.__mmkvStore = backing

vi.mock('react-native-mmkv', () => {
  const store = (globalThis as unknown as { __mmkvStore: MmkvStore }).__mmkvStore
  class FakeMMKV {
    getString(key: string) {
      const value = store.get(key)
      return typeof value === 'string' ? value : undefined
    }
    getNumber(key: string) {
      const value = store.get(key)
      return typeof value === 'number' ? value : undefined
    }
    set(key: string, value: string | number) {
      store.set(key, value)
    }
    delete(key: string) {
      store.delete(key)
    }
    getAllKeys() {
      return [...store.keys()]
    }
    clearAll() {
      store.clear()
    }
  }
  return { MMKV: FakeMMKV }
})

describe('mmkv storage', () => {
  beforeEach(() => {
    backing.clear()
    vi.resetModules()
  })

  it('round-trips cached transactions per item, defaulting to an empty array', async () => {
    const { getCachedTransactions, setCachedTransactions } = await import('./mmkv')
    expect(getCachedTransactions('item-1')).toEqual([])

    const txns = [{ transaction_id: 't1' }] as never
    setCachedTransactions('item-1', txns)

    expect(getCachedTransactions('item-1')).toEqual(txns)
  })

  it('round-trips the sync cursor per item, independent of other items', async () => {
    const { getCursor, setCursor } = await import('./mmkv')
    expect(getCursor('item-1')).toBeUndefined()

    setCursor('item-1', 'cursor-abc')
    setCursor('item-2', 'cursor-xyz')

    expect(getCursor('item-1')).toBe('cursor-abc')
    expect(getCursor('item-2')).toBe('cursor-xyz')
  })

  it('clears transactions, cursors and pending removals together on a user change', async () => {
    const {
      appendPendingRemovedTransactionIds,
      clearTransactionCache,
      getCachedTransactions,
      getCursor,
      getPendingRemovedTransactionIds,
      setCachedTransactions,
      setCursor,
    } = await import('./mmkv')

    setCachedTransactions('item-1', [{ transaction_id: 't1' }] as never)
    setCursor('item-1', 'cursor-abc')
    appendPendingRemovedTransactionIds(['t9'])

    clearTransactionCache()

    // The cursor matters as much as the bodies: leaving it behind means the next sync asks
    // Plaid only for the delta and the previous user's rows are never rebuilt.
    expect(getCachedTransactions('item-1')).toEqual([])
    expect(getCursor('item-1')).toBeUndefined()
    expect(getPendingRemovedTransactionIds()).toEqual([])
  })

  describe('stale investment cache purge', () => {
    // The backend filter governs new fetches only, and the merge is additive, so rows an older
    // filter admitted are replayed from disk forever: shown in the feed and the account sheet,
    // and offered to the matcher. The version bump plus this purge is what makes a stricter
    // filter retroactive. Both prior namespaces are covered because the purge is written as
    // "in the investment namespace but not the current version", not as a list of old prefixes.
    it('drops every superseded investment namespace on module load', async () => {
      // v1: full activity, trades included.
      backing.set('investment-txns:item-1', JSON.stringify([{ investmentTransactionId: 'itx-sell' }]))
      backing.set('investment-txns-backfilled-through:item-1', '2026-08-08')
      backing.set('investment-txns-failed-attempts:item-1', 2)
      // v2: subtype-filtered, but security-linked corporate actions slipped through.
      backing.set('investment-transfers:item-1', JSON.stringify([{ investmentTransactionId: 'itx-crwd-dist' }]))
      backing.set('investment-transfers-backfilled-through:item-1', '2026-08-08')
      // v3: required type 'cash', so it never ingested the transfer-typed funding some
      // institutions report. Its backfilled-through marker has to go with its rows — left
      // behind, it would cap the next fetch at the 30-day overlap and the older funding rows
      // the v4 filter now admits would stay permanently out of range.
      backing.set('investment-transfers-v3:item-1', JSON.stringify([{ investmentTransactionId: 'itx-3' }]))
      backing.set('investment-transfers-v3-backfilled-through:item-1', '2026-08-08')

      await import('./mmkv')

      expect([...backing.keys()].filter((k) => k.startsWith('investment-'))).toEqual([])
    })

    it('leaves the current namespace and unrelated keys untouched', async () => {
      backing.set('investment-transfers-v4:item-1', JSON.stringify([{ investmentTransactionId: 'itx-1' }]))
      backing.set('investment-transfers-v4-backfilled-through:item-1', '2026-08-08')
      backing.set('transactions:item-1', JSON.stringify([{ transaction_id: 't1' }]))
      backing.set('cursor:item-1', 'cursor-abc')

      await import('./mmkv')

      expect(backing.has('investment-transfers-v4:item-1')).toBe(true)
      expect(backing.has('investment-transfers-v4-backfilled-through:item-1')).toBe(true)
      expect(backing.has('transactions:item-1')).toBe(true)
      expect(backing.has('cursor:item-1')).toBe(true)
    })

    // Distinct from the purge above, and it holds even if the purge never runs: the accessors
    // read the current namespace, so a superseded marker cannot be mistaken for a completed
    // backfill.
    it('never reads a superseded backfill marker, so the next sync re-backfills in full', async () => {
      backing.set('investment-transfers-backfilled-through:item-1', '2026-08-08')

      const { getInvestmentBackfilledThrough } = await import('./mmkv')

      // Undefined is what fetchWindow reads as "never backfilled", so the next sync asks for the
      // full 24 months again rather than a 30-day overlap on top of poisoned rows.
      expect(getInvestmentBackfilledThrough('item-1')).toBeUndefined()
    })
  })
})
