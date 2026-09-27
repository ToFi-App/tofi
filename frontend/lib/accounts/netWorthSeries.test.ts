import { describe, expect, it } from 'vitest'
import { buildNetWorthSeries, periodStart, stackMonth } from './netWorthSeries'
import { CASH_ON_HAND_KEY } from './composition'
import type { FeedItem } from '@/lib/transactions/resolveFeed'
import type { Account } from '@/types/domain'

function account(id: string, type: string, current: number): Account {
  return { account_id: id, name: id, type, balances: { current } } as unknown as Account
}

const manualCash = { id: 'm', source: 'manual', amount: -80, date: '2026-07-01' } as FeedItem

describe('buildNetWorthSeries', () => {
  const accounts = [
    account('savings', 'depository', 900),
    account('card', 'credit', 300),
    account('checking', 'depository', 2500),
    account('ira', 'investment', 10_000),
    account('loan', 'loan', 4000),
  ]

  it('orders cash, then investments, then debt — largest first inside each group', () => {
    const { series } = buildNetWorthSeries(accounts, [manualCash])
    expect(series.map((s) => [s.key, s.group, s.indexInGroup])).toEqual([
      ['checking', 'cash', 0],
      ['savings', 'cash', 1],
      [CASH_ON_HAND_KEY, 'cash', 2],
      ['ira', 'investment', 0],
      ['loan', 'liability', 0],
      ['card', 'liability', 1],
    ])
  })

  it('anchors each account at its balance signed as net worth counts it', () => {
    const { anchors } = buildNetWorthSeries(accounts, [manualCash])
    expect(anchors.get('card')).toBe(-300)
    expect(anchors.get('checking')).toBe(2500)
    expect(anchors.get(CASH_ON_HAND_KEY)).toBe(80)
  })

  it('leaves cash on hand out until a manual entry exists', () => {
    const { series } = buildNetWorthSeries(accounts, [])
    expect(series.some((s) => s.key === CASH_ON_HAND_KEY)).toBe(false)
  })
})

describe('stackMonth', () => {
  const { series } = buildNetWorthSeries(
    [account('ira', 'investment', 1), account('checking', 'depository', 1), account('card', 'credit', 1)],
    [],
  )

  it('stacks assets up from zero and negatives down from zero, in series order', () => {
    const balances = new Map([
      ['ira', 1000],
      ['checking', 200],
      ['card', -150],
    ])
    expect(stackMonth(series, balances)).toEqual([
      { key: 'checking', from: 0, to: 200 },
      { key: 'ira', from: 200, to: 1200 },
      { key: 'card', from: 0, to: -150 },
    ])
  })

  it('sends an overdrawn asset below the line and skips zero balances', () => {
    const balances = new Map([
      ['ira', 0],
      ['checking', -40],
      ['card', -150],
    ])
    expect(stackMonth(series, balances)).toEqual([
      { key: 'checking', from: 0, to: -40 },
      { key: 'card', from: -40, to: -190 },
    ])
  })
})

describe('periodStart', () => {
  it('undoes the first month, landing on each balance as the period opened', () => {
    const months = [
      { year: 2026, month: 1, balances: new Map([['a', 900], ['card', -300]]), flow: new Map([['a', 100], ['card', -50]]) },
      { year: 2026, month: 2, balances: new Map([['a', 800], ['card', -300]]), flow: new Map([['a', 100]]) },
    ]
    expect(periodStart(months)).toEqual(new Map([['a', 1000], ['card', -350]]))
  })

  it('is empty when there are no months', () => {
    expect(periodStart([]).size).toBe(0)
  })
})
