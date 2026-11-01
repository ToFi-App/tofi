import { describe, expect, it } from 'vitest'
import { combineHistoryPoints, holdingRangeChange, mergeHoldings, uniqueSplits } from './portfolio'
import type { Holding, InvestmentActivity } from '@/types/domain'

const holding = (overrides: Partial<Holding>): Holding =>
  ({
    securityId: 'sec-a',
    name: 'Fund A',
    ticker: 'AAA',
    type: 'equity',
    quantity: 10,
    institutionValue: 1000,
    costBasis: 800,
    institutionPrice: 100,
    closePrice: 98,
    priceAsOf: '2026-10-30',
    optionContract: null,
    isoCurrencyCode: 'USD',
    ...overrides,
  }) as Holding

describe('mergeHoldings', () => {
  it('adds the same security held in two accounts into one position', () => {
    const merged = mergeHoldings([[holding({})], [holding({ quantity: 5, institutionValue: 500, costBasis: 450 })]])
    expect(merged).toHaveLength(1)
    expect(merged[0]).toMatchObject({ quantity: 15, institutionValue: 1500, costBasis: 1250 })
  })

  it('drops cost basis when one account did not report it, rather than printing a partial gain', () => {
    const merged = mergeHoldings([[holding({})], [holding({ costBasis: null })]])
    expect(merged[0].costBasis).toBeNull()
  })

  it('keeps the older price date', () => {
    const merged = mergeHoldings([[holding({ priceAsOf: '2026-10-31' })], [holding({ priceAsOf: '2026-10-29' })]])
    expect(merged[0].priceAsOf).toBe('2026-10-29')
  })

  it('leaves different securities apart', () => {
    expect(mergeHoldings([[holding({})], [holding({ securityId: 'sec-b' })]])).toHaveLength(2)
  })
})

describe('combineHistoryPoints', () => {
  it('carries an account forward over a day it has no point for', () => {
    const combined = combineHistoryPoints([
      [
        { date: '2026-10-01', value: 100, netDeposits: 0 },
        { date: '2026-10-03', value: 110, netDeposits: 0 },
      ],
      [
        { date: '2026-10-01', value: 50, netDeposits: 0 },
        { date: '2026-10-02', value: 55, netDeposits: 0 },
      ],
    ])
    expect(combined.map((p) => [p.date, p.value])).toEqual([
      ['2026-10-01', 150],
      ['2026-10-02', 155],
      ['2026-10-03', 165],
    ])
  })
})

describe('holdingRangeChange', () => {
  const closes = {
    AAA: [
      { date: '2025-12-31', close: 80 },
      { date: '2026-06-30', close: 90 },
      { date: '2026-10-30', close: 95 },
    ],
  }
  const trade = (date: string, subtype: 'buy' | 'sell', quantity: number, amount: number, securityId = 'sec-a') =>
    ({ investmentTransactionId: `${date}-${subtype}`, date, securityId, type: subtype, subtype, quantity, amount, price: 0, isCashTransfer: false }) as InvestmentActivity
  const base = { closes, splits: [], start: '2026-01-01', today: '2026-10-31' }

  it('compares a position opened inside the window with what was paid for it', () => {
    // 10 shares bought for $900 in June; worth $1,000 now.
    const change = holdingRangeChange({ ...base, holding: holding({}), activity: [trade('2026-06-30', 'buy', 10, 900)] })
    expect(change?.gain).toBe(100)
    expect(change?.pct).toBeCloseTo(100 / 900)
  })

  it('measures a position held from before the window from its value then', () => {
    // 10 shares held all year at $80 on Jan 1, $100 now; an unrelated trade elsewhere doesn't count.
    const change = holdingRangeChange({ ...base, holding: holding({}), activity: [trade('2026-03-01', 'buy', 1, 85, 'other')] })
    expect(change?.gain).toBe(200)
  })

  it('does not count money added during the window as a gain', () => {
    // 5 shares at Jan 1 ($400), 5 more bought for $450; 10 worth $1,000 now: gain is $150.
    const change = holdingRangeChange({ ...base, holding: holding({}), activity: [trade('2026-06-30', 'buy', 5, 450)] })
    expect(change?.gain).toBe(150)
    expect(change?.pct).toBeCloseTo(150 / 850)
  })

  it('carries shares and the starting close onto today\'s basis across a split', () => {
    // 5 shares bought for $450 before a 2-for-1 split are today's 10; worth $1,000 now.
    const splits = [{ symbol: 'AAA', exDate: '2026-08-01', oldRate: 1, newRate: 2 }]
    const change = holdingRangeChange({ ...base, splits, holding: holding({}), activity: [trade('2026-06-30', 'buy', 5, 450)] })
    expect(change?.gain).toBe(550)
  })

  it('falls back to the cost basis when the institution reports no activity', () => {
    expect(holdingRangeChange({ ...base, holding: holding({}), activity: [] })?.gain).toBe(200)
  })
})

describe('uniqueSplits', () => {
  it('keeps each split once when every account carried a copy', () => {
    const split = { symbol: 'AAA', exDate: '2026-03-18', oldRate: 4, newRate: 1 }
    expect(uniqueSplits([split, split, split, { ...split, symbol: 'BBB' }])).toHaveLength(2)
  })
})
