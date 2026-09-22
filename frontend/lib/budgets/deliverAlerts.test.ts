import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Budget, Category } from '@/types/domain'
import type { FeedItem } from '@/lib/transactions/resolveFeed'

// Same shape as lib/storage/mmkv.test.ts: the backing map lives on globalThis so the fake
// survives module resets, and the test can inspect what the delivery pass persisted.
type MmkvStore = Map<string, string | number | boolean>
const globalWithStore = globalThis as unknown as { __alertStore?: MmkvStore }
const backing: MmkvStore = new Map()
globalWithStore.__alertStore = backing

vi.mock('react-native-mmkv', () => {
  const store = (globalThis as unknown as { __alertStore: MmkvStore }).__alertStore
  class FakeMMKV {
    getBoolean(key: string) {
      const value = store.get(key)
      return typeof value === 'boolean' ? value : undefined
    }
    getString(key: string) {
      const value = store.get(key)
      return typeof value === 'string' ? value : undefined
    }
    set(key: string, value: string | number | boolean) {
      store.set(key, value)
    }
    delete(key: string) {
      store.delete(key)
    }
    getAllKeys() {
      return [...store.keys()]
    }
  }
  return { MMKV: FakeMMKV }
})

type NotificationRequest = { content: { title: string; body: string }; trigger: null }
const scheduleNotificationAsync = vi.fn(async (_request: NotificationRequest) => 'notification-id')
vi.mock('expo-notifications', () => ({ scheduleNotificationAsync: (request: NotificationRequest) => scheduleNotificationAsync(request) }))

const ensureNotificationPermission = vi.fn(async (_options: { canPrompt: boolean }) => true)
vi.mock('@/lib/notifications/permission', () => ({
  ensureNotificationPermission: (options: { canPrompt: boolean }) => ensureNotificationPermission(options),
}))

const getBudgetAlertsEnabled = vi.fn(() => true)
vi.mock('@/lib/notifications/preference', () => ({ getBudgetAlertsEnabled: () => getBudgetAlertsEnabled() }))

const { deliverBudgetAlerts } = await import('./deliverAlerts')

// Fixed "now" so the month the pass computes is the month the fixtures are written in.
const TODAY = new Date('2026-08-20T12:00:00Z')

function budget(overrides: Partial<Budget> & Pick<Budget, 'id' | 'categoryId' | 'amount'>): Budget {
  return { period: 'monthly', alertThreshold: 80, effectiveMonth: '2026-08-01', ...overrides } as Budget
}

function spend(id: string, categoryId: string, amount: number, date = '2026-08-10'): FeedItem {
  return {
    id,
    source: 'plaid',
    amount,
    date,
    postedDate: date,
    merchantName: 'Somewhere',
    categoryId,
    subcategoryId: null,
    categorySource: 'plaid_pfc',
    confidenceLevel: null,
    pfcDetailed: null,
    accountId: 'acct-1',
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
  }
}

const categories = [{ id: 'food', name: 'Food', icon: 'food' }] as unknown as Category[]
const budgets = [budget({ id: 'b1', categoryId: 'food', amount: '500.00' })] // alert line at $400

function run(feed: FeedItem[], canPrompt = true) {
  return deliverBudgetAlerts({ feed, budgets, categories, canPrompt })
}

describe('deliverBudgetAlerts', () => {
  beforeEach(() => {
    backing.clear()
    scheduleNotificationAsync.mockClear()
    ensureNotificationPermission.mockClear().mockResolvedValue(true)
    getBudgetAlertsEnabled.mockClear().mockReturnValue(true)
    vi.useFakeTimers()
    vi.setSystemTime(TODAY)
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('delivers a crossing once and stays quiet on every pass after it', async () => {
    expect(await run([spend('t1', 'food', 450)])).toBe(1)
    expect(scheduleNotificationAsync).toHaveBeenCalledTimes(1)
    expect(await run([spend('t1', 'food', 450)])).toBe(0)
    expect(scheduleNotificationAsync).toHaveBeenCalledTimes(1)
  })

  it('says nothing below the line', async () => {
    expect(await run([spend('t1', 'food', 399)])).toBe(0)
    expect(scheduleNotificationAsync).not.toHaveBeenCalled()
  })

  it('costs nothing and asks for nothing while the switch is off', async () => {
    getBudgetAlertsEnabled.mockReturnValue(false)
    expect(await run([spend('t1', 'food', 450)])).toBe(0)
    expect(ensureNotificationPermission).not.toHaveBeenCalled()
    expect(scheduleNotificationAsync).not.toHaveBeenCalled()
    // Nothing was marked, so turning the switch back on announces what is still crossed.
    getBudgetAlertsEnabled.mockReturnValue(true)
    expect(await run([spend('t1', 'food', 450)])).toBe(1)
  })

  it('leaves the crossing unmarked when permission is refused, so a later pass can deliver it', async () => {
    ensureNotificationPermission.mockResolvedValue(false)
    expect(await run([spend('t1', 'food', 450)])).toBe(0)
    ensureNotificationPermission.mockResolvedValue(true)
    expect(await run([spend('t1', 'food', 450)])).toBe(1)
  })

  it('passes canPrompt through — a background wake must not raise the OS dialog', async () => {
    await run([spend('t1', 'food', 450)], false)
    expect(ensureNotificationPermission).toHaveBeenCalledWith({ canPrompt: false })
  })

  it('reads over budget rather than past the line once spending exceeds the amount', async () => {
    await run([spend('t1', 'food', 620)])
    const body = scheduleNotificationAsync.mock.calls[0]![0].content.body
    expect(body).toContain('over budget')
  })

  it('drops fired marks from past months instead of keeping them for the life of the install', async () => {
    backing.set('b1:2026-07-01:80', true)
    backing.set('b9:2026-01-01:50', true)
    await run([spend('t1', 'food', 450)])
    expect(backing.has('b1:2026-07-01:80')).toBe(false)
    expect(backing.has('b9:2026-01-01:50')).toBe(false)
    expect(backing.get('b1:2026-08-01:80')).toBe(true)
  })
})
