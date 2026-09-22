import { describe, expect, it } from 'vitest'
import { findOrphanedTransfers } from './orphanCleanup'
import type { FeedItem } from '@/lib/transactions/resolveFeed'
import type { Transfer } from '@/types/domain'

function transfer(overrides: Partial<Transfer> & Pick<Transfer, 'id'>): Transfer {
  return {
    kind: 'credit_card_payment',
    source: 'auto',
    expensePlaidTransactionId: `out-${overrides.id}`,
    expenseManualTransactionId: null,
    incomePlaidTransactionId: `in-${overrides.id}`,
    incomeManualTransactionId: null,
    amount: '500.00',
    note: null,
    ...overrides,
  }
}

function item(overrides: Partial<FeedItem> & Pick<FeedItem, 'id' | 'amount'>): FeedItem {
  return {
    source: 'plaid',
    date: '2026-08-01',
    merchantName: 'Test',
    categoryId: null,
    subcategoryId: null,
    categorySource: 'uncategorized',
    confidenceLevel: null,
    pfcDetailed: null,
    accountId: 'checking',
    pending: false,
    note: null,
    reimbursedAmount: null,
    netAmount: null,
    isReimbursementIncome: false,
    reimbursementCategoryId: null,
    transferId: null,
    transferKind: null,
    transferRole: null,
    transferSource: null,
    isBrokerageCashAccount: false,
    isSweptOutflow: false,
    hasCrossAccountCounterpart: false,
    links: [],
    ...overrides,
    // Tracks `date`: these cases care about the display/bucketing date, and letting the
    // two drift would quietly change what any proximity assertion means.
    postedDate: overrides.postedDate ?? overrides.date ?? '2026-08-01',
  }
}

/** Both legs present and healthy for transfer t1. */
function healthyFeed(): Map<string, FeedItem> {
  return new Map([
    ['out-t1', item({ id: 'out-t1', amount: 500 })],
    ['in-t1', item({ id: 'in-t1', amount: -500 })],
  ])
}

function run(transfers: Transfer[], feedById: Map<string, FeedItem>, pendingRemovedIds: string[] = []) {
  return findOrphanedTransfers({ transfers, feedById, pendingRemovedIds })
}

describe('findOrphanedTransfers: retraction', () => {
  it('dissolves a transfer whose expense leg was removed by Plaid', () => {
    const result = run([transfer({ id: 't1' })], healthyFeed(), ['out-t1'])
    expect(result.dissolveTransferIds).toEqual(['t1'])
    expect(result.clearableRemovedIds).toEqual([])
  })

  it('dissolves a transfer whose income leg was removed by Plaid', () => {
    const result = run([transfer({ id: 't1' })], healthyFeed(), ['in-t1'])
    expect(result.dissolveTransferIds).toEqual(['t1'])
  })

  it('dissolves manual and reimbursement transfers too — a ghost leg hides money regardless of source', () => {
    const manual = transfer({ id: 't1', source: 'manual', kind: 'reimbursement' })
    const result = run([manual], healthyFeed(), ['in-t1'])
    expect(result.dissolveTransferIds).toEqual(['t1'])
  })

  it('keeps a removed id queued until no transfer references it, then clears it', () => {
    // Still referenced: not clearable (the delete must be verified first).
    const before = run([transfer({ id: 't1' })], healthyFeed(), ['out-t1'])
    expect(before.clearableRemovedIds).toEqual([])

    // After the deletion lands (refetched list no longer has t1): clearable.
    const after = run([], healthyFeed(), ['out-t1'])
    expect(after.dissolveTransferIds).toEqual([])
    expect(after.clearableRemovedIds).toEqual(['out-t1'])
  })

  it('clears removed ids that never referenced any transfer', () => {
    const result = run([transfer({ id: 't1' })], healthyFeed(), ['unrelated-txn'])
    expect(result.dissolveTransferIds).toEqual([])
    expect(result.clearableRemovedIds).toEqual(['unrelated-txn'])
  })
})

describe('findOrphanedTransfers: drift (auto only)', () => {
  it('dissolves an auto transfer whose modified leg no longer matches the amount', () => {
    const feed = healthyFeed()
    feed.set('in-t1', item({ id: 'in-t1', amount: -450 })) // amount drifted
    expect(run([transfer({ id: 't1' })], feed).dissolveTransferIds).toEqual(['t1'])
  })

  it('dissolves an auto transfer whose leg flipped sign', () => {
    const feed = healthyFeed()
    feed.set('out-t1', item({ id: 'out-t1', amount: -500 })) // expense leg became an inflow
    expect(run([transfer({ id: 't1' })], feed).dissolveTransferIds).toEqual(['t1'])
  })

  it('never dissolves a manual transfer on amount drift — the sheet tolerates ±5% and the user vouched', () => {
    const feed = healthyFeed()
    feed.set('in-t1', item({ id: 'in-t1', amount: -485 })) // within the sheet's tolerance
    const manual = transfer({ id: 't1', source: 'manual', kind: 'account_transfer' })
    expect(run([manual], feed).dissolveTransferIds).toEqual([])
  })

  it('draws no conclusion from an absent leg — outside the window or a rebuilt cache is not retraction', () => {
    const feed = new Map([['out-t1', item({ id: 'out-t1', amount: 500 })]]) // income leg not loaded
    expect(run([transfer({ id: 't1' })], feed).dissolveTransferIds).toEqual([])
  })

  it('leaves a healthy auto transfer untouched', () => {
    expect(run([transfer({ id: 't1' })], healthyFeed()).dissolveTransferIds).toEqual([])
  })
})
