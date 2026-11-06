import { describe, expect, it, vi } from 'vitest'
import { createElement } from 'react'
import TestRenderer, { act } from 'react-test-renderer'
import type { FeedItem } from '@/lib/transactions/resolveFeed'

/**
 * Drives the real useTransactionEditor through the reimbursement handoff.
 *
 * The pure transition functions are tested in lib/transfers/transferReturn.test.ts; this covers what
 * they cannot — that the hook wires them together correctly, with React's own batching, so the
 * sequence a user performs leaves a sheet open. The bug this guards against dropped the user back to
 * the account list with the edit discarded, and no unit test of a helper could have caught it.
 */

// react-native cannot be imported under vitest's node environment, and the hook only reaches for
// Alert (the manual-delete confirmation, which this file never triggers).
vi.mock('react-native', () => ({ Alert: { alert: vi.fn() } }))

const noopMutations = {
  create: vi.fn(async () => {}),
  update: vi.fn(async () => {}),
  delete: vi.fn(async () => {}),
  upsert: vi.fn(async () => {}),
  createMany: vi.fn(async () => {}),
  unmark: vi.fn(async () => {}),
  data: [],
  isLoading: false,
  isSaving: false,
  error: null,
}

vi.mock('./useAccounts', () => ({ useAccounts: () => ({ data: [], itemErrors: [] }) }))
vi.mock('./useCategories', () => ({ useCategories: () => ({ data: [] }) }))
vi.mock('./useSubcategories', () => ({ useSubcategories: () => ({ data: [] }) }))
vi.mock('./useTransactionOverrides', () => ({ useTransactionOverrides: () => noopMutations }))
vi.mock('./useVendorMappings', () => ({ useVendorMappings: () => noopMutations }))
vi.mock('./useTransfers', () => ({ useTransfers: () => noopMutations }))
vi.mock('./useManualTransactions', () => ({ useManualTransactions: () => noopMutations }))

const { useTransactionEditor } = await import('./useTransactionEditor')
const { activeSheetOf } = await import('@/lib/transfers/transferReturn')

function feedItem(overrides: Partial<FeedItem> = {}): FeedItem {
  return {
    id: 'card-expense',
    source: 'plaid',
    amount: 42,
    date: '2026-08-20',
    merchantName: 'Lao Jie Hot Pot',
    accountId: 'acc-card',
    links: [],
    transferKind: null,
    isReimbursementIncome: false,
    ...overrides,
  } as FeedItem
}

/** Renders the hook and returns a live handle to its latest value. */
function mountEditor(feed: FeedItem[]) {
  const ref: { current: ReturnType<typeof useTransactionEditor> | null } = { current: null }
  function Harness() {
    ref.current = useTransactionEditor(feed)
    return null
  }
  act(() => {
    TestRenderer.create(createElement(Harness))
  })
  return {
    get editor() {
      if (!ref.current) throw new Error('editor not mounted')
      return ref.current
    },
    get active() {
      const e = ref.current!
      return activeSheetOf({
        detailItem: e.activeSheetItem,
        transferItem: e.transferItem,
        manualOpen: e.manualSheetOpen,
      })
    },
  }
}

describe('the reimbursement handoff, through the real editor', () => {
  it('leaves a sheet open at every step and lands back on the expense', () => {
    const expense = feedItem()
    const income = feedItem({ id: 'checking-income', amount: -42, accountId: 'acc-checking' })
    const harness = mountEditor([expense, income])

    expect(harness.active).toBeNull()

    act(() => harness.editor.openTransaction(expense))
    expect(harness.active).toBe('detail')

    act(() => harness.editor.openTransfer('reimbursement'))
    expect(harness.active).toBe('transfer')
    expect(harness.editor.transferForcedKind).toBe('reimbursement')

    act(() => harness.editor.confirmTransfer({ kind: 'reimbursement', counterpartIds: [income.id] }))

    // The regression: this used to be null, dismissing the whole edit flow mid-reimbursement.
    expect(harness.active).toBe('detail')
    expect(harness.editor.activeSheetItem?.id).toBe('card-expense')
    expect(harness.editor.transferItem).toBeNull()
    expect(harness.editor.pendingTransfer?.kind).toBe('reimbursement')
    expect(harness.editor.pendingTransfer?.counterpartItems.map((i) => i.id)).toEqual(['checking-income'])
  })

  it('declining also returns to the expense rather than closing everything', () => {
    const expense = feedItem()
    const harness = mountEditor([expense])

    act(() => harness.editor.openTransaction(expense))
    act(() => harness.editor.openTransfer('reimbursement'))
    act(() => harness.editor.declineTransfer())

    expect(harness.active).toBe('detail')
    expect(harness.editor.activeSheetItem?.id).toBe('card-expense')
    expect(harness.editor.pendingTransfer).toBeNull()
  })

  it('offers the opposite-signed counterpart from another account', () => {
    // Reimbursements pair a card expense with income in checking, so candidates must cross accounts.
    const expense = feedItem()
    const income = feedItem({ id: 'checking-income', amount: -42, accountId: 'acc-checking' })
    const harness = mountEditor([expense, income])

    act(() => harness.editor.openTransaction(expense))
    act(() => harness.editor.openTransfer('reimbursement'))

    expect(harness.editor.transferCandidateItems.map((i) => i.id)).toEqual(['checking-income'])
  })

  it('closing the detail sheet is still the only way the flow ends with nothing open', () => {
    const expense = feedItem()
    const harness = mountEditor([expense])

    act(() => harness.editor.openTransaction(expense))
    act(() => harness.editor.closeDetailSheet())

    expect(harness.active).toBeNull()
  })
})

describe('opening a linked transaction from the detail sheet', () => {
  const link = (itemId: string | null) => ({
    recordId: 'r1',
    kind: 'reimbursement' as const,
    itemId,
    merchantName: 'Noodle House',
    date: '2026-08-18',
    accountId: 'acc-card',
    amount: 30,
    counterpartAmount: 50,
  })

  it('swaps the open sheet for the counterpart', () => {
    const expense = feedItem({ id: 'dinner', amount: 50 })
    const payback = feedItem({ id: 'venmo', amount: -30, accountId: 'acc-checking', isReimbursementIncome: true, links: [link('dinner')] })
    const harness = mountEditor([expense, payback])

    act(() => harness.editor.openTransaction(payback))
    act(() => harness.editor.openLink(link('dinner')))

    expect(harness.active).toBe('detail')
    expect(harness.editor.activeSheetItem?.id).toBe('dinner')
  })

  it('opens a manual counterpart in the manual sheet, with the detail sheet let go', () => {
    const expense = feedItem({ id: 'cash-dinner', source: 'manual', amount: 50 })
    const payback = feedItem({ id: 'venmo', amount: -30, isReimbursementIncome: true, links: [link('cash-dinner')] })
    const harness = mountEditor([expense, payback])

    act(() => harness.editor.openTransaction(payback))
    act(() => harness.editor.openLink(link('cash-dinner')))

    expect(harness.active).toBe('manual')
    expect(harness.editor.editingManual?.id).toBe('cash-dinner')
  })

  it('stays put when the counterpart is not in the feed', () => {
    const payback = feedItem({ id: 'venmo', amount: -30, isReimbursementIncome: true, links: [link(null)] })
    const harness = mountEditor([payback])

    act(() => harness.editor.openTransaction(payback))
    act(() => harness.editor.openLink(link(null)))

    expect(harness.editor.activeSheetItem?.id).toBe('venmo')
  })
})
