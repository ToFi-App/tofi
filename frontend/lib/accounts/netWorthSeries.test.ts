import { describe, expect, it } from 'vitest'
import { buildNetWorthSeries, periodChanges, periodStart } from './netWorthSeries'
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

describe('periodStart', () => {
  it("is the first month's opening balances", () => {
    const months = [
      { balances: new Map([['a', 900]]), startBalances: new Map([['a', 1000], ['card', -350]]) },
      { balances: new Map([['a', 800]]), startBalances: new Map([['a', 900]]) },
    ]
    expect(periodStart(months)).toEqual(new Map([['a', 1000], ['card', -350]]))
  })

  it('is empty when there are no months', () => {
    expect(periodStart([]).size).toBe(0)
  })
})

describe('periodChanges', () => {
  it("is each account's move during the point — close minus open — leaving out accounts that didn't move", () => {
    const changes = periodChanges({
      balances: new Map([['checking', 1200], ['card', -450], ['ira', 5000]]),
      startBalances: new Map([['checking', 1000], ['card', -300], ['ira', 5000]]),
    })
    expect(changes).toEqual(new Map([['checking', 200], ['card', -150]]))
  })

  it('counts an account that appeared this period from zero', () => {
    const changes = periodChanges({ balances: new Map([['cma', 350]]), startBalances: new Map([['cma', 0]]) })
    expect(changes.get('cma')).toBe(350)
  })
})
