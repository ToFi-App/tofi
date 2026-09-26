import { describe, expect, it } from 'vitest'
import { planSyncMerge } from './planSyncMerge'
import type { SyncResultShape } from './planSyncMerge'
import type { PlaidTransaction } from '@/types/domain'

function txn(transaction_id: string, account_id: string, amount = 10): PlaidTransaction {
  return { transaction_id, account_id, amount } as PlaidTransaction
}

const ACCOUNT_TO_ITEM = new Map([
  ['acc-1', 'item-1'],
  ['acc-2', 'item-2'],
])

function result(overrides: Partial<SyncResultShape>): SyncResultShape {
  return { added: [], modified: [], removed: [], cursors: {}, ...overrides }
}

describe('planSyncMerge', () => {
  it('appends added transactions to their item cache', () => {
    const plan = planSyncMerge(
      result({ added: [txn('t2', 'acc-1')], cursors: { 'item-1': 'cur-2' } }),
      ['item-1'],
      ACCOUNT_TO_ITEM,
      new Map([['item-1', [txn('t1', 'acc-1')]]]),
    )
    expect(plan.mergedByItem.get('item-1')?.map((t) => t.transaction_id).sort()).toEqual(['t1', 't2'])
    expect(plan.cursors).toEqual({ 'item-1': 'cur-2' })
  })

  it('replaces modified transactions instead of duplicating them', () => {
    const plan = planSyncMerge(
      result({ modified: [txn('t1', 'acc-1', 99)] }),
      ['item-1'],
      ACCOUNT_TO_ITEM,
      new Map([['item-1', [txn('t1', 'acc-1', 10)]]]),
    )
    const merged = plan.mergedByItem.get('item-1') ?? []
    expect(merged).toHaveLength(1)
    expect(merged[0].amount).toBe(99)
  })

  it('drops removed transactions and reports their ids for the orphan queue', () => {
    const plan = planSyncMerge(
      result({ removed: [{ transaction_id: 't1' }] }),
      ['item-1'],
      ACCOUNT_TO_ITEM,
      new Map([['item-1', [txn('t1', 'acc-1'), txn('t2', 'acc-1')]]]),
    )
    expect(plan.mergedByItem.get('item-1')?.map((t) => t.transaction_id)).toEqual(['t2'])
    expect(plan.removedIds).toEqual(['t1'])
  })

  it('routes transactions to the right item and ignores unknown accounts', () => {
    const plan = planSyncMerge(
      result({ added: [txn('t1', 'acc-1'), txn('t2', 'acc-2'), txn('t3', 'acc-unknown')] }),
      ['item-1', 'item-2'],
      ACCOUNT_TO_ITEM,
      new Map(),
    )
    expect(plan.mergedByItem.get('item-1')?.map((t) => t.transaction_id)).toEqual(['t1'])
    expect(plan.mergedByItem.get('item-2')?.map((t) => t.transaction_id)).toEqual(['t2'])
  })

  it('is idempotent: re-applying the same payload changes nothing', () => {
    const payload = result({ added: [txn('t2', 'acc-1')], removed: [{ transaction_id: 't1' }] })
    const cached = new Map([['item-1', [txn('t1', 'acc-1'), txn('t2', 'acc-1')]]])
    const once = planSyncMerge(payload, ['item-1'], ACCOUNT_TO_ITEM, cached)
    const twice = planSyncMerge(payload, ['item-1'], ACCOUNT_TO_ITEM, once.mergedByItem)
    expect(twice.mergedByItem.get('item-1')).toEqual(once.mergedByItem.get('item-1'))
  })

  it('reports hasMore when any item has pages left', () => {
    expect(planSyncMerge(result({ hasMore: { a: false, b: true } }), [], ACCOUNT_TO_ITEM, new Map()).hasMore).toBe(true)
    expect(planSyncMerge(result({ hasMore: { a: false } }), [], ACCOUNT_TO_ITEM, new Map()).hasMore).toBe(false)
    expect(planSyncMerge(result({}), [], ACCOUNT_TO_ITEM, new Map()).hasMore).toBe(false)
  })

  it('surfaces the ids of rate-limited items so the driver can back off', () => {
    const plan = planSyncMerge(
      result({ hasMore: { 'item-1': true, 'item-2': false }, rateLimited: { 'item-1': true } }),
      ['item-1', 'item-2'],
      ACCOUNT_TO_ITEM,
      new Map(),
    )
    expect(plan.rateLimitedItemIds).toEqual(['item-1'])
    // Still hasMore: the item has pages left, it just may not be asked for them yet.
    expect(plan.hasMore).toBe(true)
  })

  it('reports no rate-limited items when the field is absent', () => {
    // Absent rather than empty is the normal case and the shape older callers still send.
    expect(planSyncMerge(result({}), [], ACCOUNT_TO_ITEM, new Map()).rateLimitedItemIds).toEqual([])
  })

  it('collects pending-to-posted ID migrations when a posted transaction replaces a removed pending one', () => {
    const posted = { ...txn('posted-1', 'acc-1'), pending_transaction_id: 'pending-1' } as PlaidTransaction
    const plan = planSyncMerge(
      result({ added: [posted], removed: [{ transaction_id: 'pending-1' }] }),
      ['item-1'],
      ACCOUNT_TO_ITEM,
      new Map([['item-1', [{ ...txn('pending-1', 'acc-1'), pending: true } as PlaidTransaction]]]),
    )
    expect(plan.pendingToPosted).toEqual([{ oldId: 'pending-1', newId: 'posted-1' }])
  })

  it('does not collect migrations when pending_transaction_id is absent or its id was not removed', () => {
    const noLink = txn('t1', 'acc-1')
    const dangling = { ...txn('t2', 'acc-1'), pending_transaction_id: 'not-removed' } as PlaidTransaction
    const plan = planSyncMerge(
      result({ added: [noLink, dangling] }),
      ['item-1'],
      ACCOUNT_TO_ITEM,
      new Map(),
    )
    expect(plan.pendingToPosted).toEqual([])
  })

})
