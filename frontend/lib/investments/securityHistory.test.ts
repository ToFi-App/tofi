import { describe, expect, it } from 'vitest'
import { buildSecurityHistory } from './securityHistory'
import type { InvestmentActivity } from '@/types/domain'

function row(overrides: Partial<InvestmentActivity>): InvestmentActivity {
  return {
    investmentTransactionId: 'txn',
    date: '2025-01-03',
    securityId: 'sec-aaa',
    type: 'buy',
    subtype: 'buy',
    quantity: 0,
    amount: 0,
    price: 0,
    isCashTransfer: false,
    ...overrides,
  }
}

const dates = ['2025-01-02', '2025-01-03', '2025-01-06']

describe('buildSecurityHistory', () => {
  it('draws one point per close in the window plus today, split-adjusted to today’s share basis', () => {
    // 2-for-1 on Jan 3: the $200 close before it reads as $100.
    const result = buildSecurityHistory({
      closes: [
        { date: '2024-12-31', close: 180 },
        { date: '2025-01-02', close: 200 },
        { date: '2025-01-03', close: 99 },
      ],
      splits: [{ symbol: 'AAA', exDate: '2025-01-03', oldRate: 1, newRate: 2 }],
      activity: [],
      startDate: '2025-01-01',
      latestPrice: 101,
      today: '2025-01-06',
    })

    expect(result?.points).toEqual([
      { date: '2025-01-02', price: 100 },
      { date: '2025-01-03', price: 99 },
      { date: '2025-01-06', price: 101 },
    ])
  })

  it('lists the position’s buys and sells for markers on the line', () => {
    const result = buildSecurityHistory({
      closes: [{ date: '2025-01-02', close: 95 }],
      splits: [],
      activity: [
        row({ date: '2025-01-06', type: 'sell', subtype: 'sell', quantity: -3, amount: -300 }),
        row({ date: '2025-01-03', subtype: 'buy', quantity: 4, amount: 380 }),
        row({ date: '2025-01-03', type: 'cash', subtype: 'dividend', amount: -12 }),
      ],
      startDate: '2025-01-01',
      latestPrice: null,
      today: '2025-01-06',
    })

    expect(result?.trades).toEqual([
      { date: '2025-01-03', kind: 'buy', quantity: 4 },
      { date: '2025-01-06', kind: 'sell', quantity: 3 },
    ])
  })

  it('ends on the last close when there is no live price', () => {
    const result = buildSecurityHistory({
      closes: [
        { date: '2025-01-02', close: 90 },
        { date: '2025-01-03', close: 95 },
      ],
      splits: [],
      activity: [],
      startDate: '2025-01-01',
      latestPrice: null,
      today: '2025-01-06',
    })

    expect(result?.points.at(-1)).toEqual({ date: '2025-01-06', price: 95 })
  })

  it('has no history for a security with no daily prices', () => {
    expect(
      buildSecurityHistory({ closes: [], splits: [], activity: [], startDate: '2025-01-01', latestPrice: null, today: '2025-01-06' }),
    ).toBeNull()
  })
})

describe('tradeTable', () => {
  it('lists buys and sells newest first, as positive quantities at their per-share price', async () => {
    const { tradeTable } = await import('./securityHistory')
    const rows = tradeTable([
      row({ investmentTransactionId: 'b1', date: '2025-01-03', subtype: 'buy', quantity: 4, price: 95 }),
      row({ investmentTransactionId: 'd1', date: '2025-01-04', type: 'cash', subtype: 'dividend', amount: -12 }),
      row({ investmentTransactionId: 's1', date: '2025-01-06', type: 'sell', subtype: 'sell', quantity: -3, price: 100 }),
    ])

    expect(rows).toEqual([
      { id: 's1', kind: 'sell', date: '2025-01-06', quantity: 3, price: 100 },
      { id: 'b1', kind: 'buy', date: '2025-01-03', quantity: 4, price: 95 },
    ])
  })
})

describe('tradeMarkers', () => {
  const visible = ['2025-01-02', '2025-01-03', '2025-01-06']

  it('puts one marker per day and direction, summing that day’s shares', async () => {
    const { tradeMarkers } = await import('./securityHistory')
    const markers = tradeMarkers(
      [
        { date: '2025-01-03', kind: 'buy', quantity: 4 },
        { date: '2025-01-03', kind: 'buy', quantity: 1 },
        { date: '2025-01-06', kind: 'sell', quantity: 3 },
      ],
      visible,
    )

    expect(markers).toEqual([
      { index: 1, kind: 'buy', quantity: 5, label: 'BUY 5 shares' },
      { index: 2, kind: 'sell', quantity: 3, label: 'SELL 3 shares' },
    ])
  })

  it('keeps a buy and a sell on the same day apart', async () => {
    const { tradeMarkers } = await import('./securityHistory')
    const markers = tradeMarkers(
      [
        { date: '2025-01-03', kind: 'buy', quantity: 2 },
        { date: '2025-01-03', kind: 'sell', quantity: 1 },
      ],
      visible,
    )

    expect(markers.map((m) => [m.index, m.kind, m.label])).toEqual([
      [1, 'buy', 'BUY 2 shares'],
      [1, 'sell', 'SELL 1 share'],
    ])
  })

  it('drops trades outside the window', async () => {
    const { tradeMarkers } = await import('./securityHistory')
    expect(tradeMarkers([{ date: '2024-12-30', kind: 'buy', quantity: 2 }], visible)).toEqual([])
  })
})
