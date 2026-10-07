import { describe, expect, it } from 'vitest'
import { buildAccountHistory, priceableSymbol, rangeGain } from './accountHistory'
import type { Holding, InvestmentActivity } from '@/types/domain'

function holding(overrides: Partial<Holding>): Holding {
  return {
    securityId: 'sec-aaa',
    name: 'Example',
    ticker: 'AAA',
    type: 'equity',
    quantity: 10,
    institutionValue: 1000,
    costBasis: null,
    institutionPrice: 100,
    closePrice: null,
    priceAsOf: null,
    optionContract: null,
    isoCurrencyCode: 'USD',
    ...overrides,
  }
}

function activity(overrides: Partial<InvestmentActivity>): InvestmentActivity {
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

const base = {
  securities: [],
  splits: [],
  startDate: '2025-01-02',
  today: '2025-01-06',
}

describe('priceableSymbol', () => {
  it('prices stocks and ETFs by ticker, nothing else', () => {
    expect(priceableSymbol({ ticker: 'VTI', type: 'etf', isOption: false })).toBe('VTI')
    expect(priceableSymbol({ ticker: 'BRK.B', type: 'equity', isOption: false })).toBe('BRK.B')
    expect(priceableSymbol({ ticker: 'VTSAX', type: 'mutual fund', isOption: false })).toBeNull()
    expect(priceableSymbol({ ticker: 'CUR:USD', type: 'cash', isOption: false })).toBeNull()
    expect(priceableSymbol({ ticker: 'NFLX', type: 'equity', isOption: true })).toBeNull()
    expect(priceableSymbol({ ticker: null, type: 'equity', isOption: false })).toBeNull()
  })
})

describe('buildAccountHistory', () => {
  it('with no activity, values today’s shares at each close and ends on the balance', () => {
    const result = buildAccountHistory({
      ...base,
      holdings: [holding({ quantity: 10, institutionValue: 1000 })],
      activity: [],
      anchorValue: 1000,
      closes: { AAA: [{ date: '2025-01-02', close: 90 }, { date: '2025-01-03', close: 95 }] },
    })

    expect(result.points.map((p) => [p.date, p.value])).toEqual([
      ['2025-01-02', 900],
      ['2025-01-03', 950],
      ['2025-01-06', 1000],
    ])
  })

  it('unwinds a buy: fewer shares and more cash before it, so the buy itself does not move the line', () => {
    // Bought 4 shares at $95 on Jan 3. Today: 10 shares ($1000) and $200 cash.
    const result = buildAccountHistory({
      ...base,
      holdings: [holding({ quantity: 10, institutionValue: 1000 })],
      activity: [activity({ date: '2025-01-03', type: 'buy', subtype: 'buy', quantity: 4, amount: 380, price: 95 })],
      anchorValue: 1200,
      closes: { AAA: [{ date: '2025-01-02', close: 95 }, { date: '2025-01-03', close: 95 }] },
    })

    // Jan 2: 6 shares x 95 + (200 + 380) cash = 1150. Jan 3: 10 x 95 + 200 = 1150.
    expect(result.points.map((p) => [p.date, p.value])).toEqual([
      ['2025-01-02', 1150],
      ['2025-01-03', 1150],
      ['2025-01-06', 1200],
    ])
  })

  it('unwinds a sell as more shares before it, whatever sign the institution put on its quantity', () => {
    // Sold 5 at $100 on Jan 3; reported with a positive quantity, as some institutions do.
    const result = buildAccountHistory({
      ...base,
      holdings: [holding({ quantity: 10, institutionValue: 1000 })],
      activity: [activity({ date: '2025-01-03', type: 'sell', subtype: 'sell', quantity: 5, amount: -500, price: 100 })],
      anchorValue: 1500,
      closes: { AAA: [{ date: '2025-01-02', close: 100 }] },
    })

    // Jan 2: 15 shares x 100 + (500 - 500) cash.
    expect(result.points[0]).toMatchObject({ date: '2025-01-02', value: 1500 })
  })

  it('prices a position sold out before today, which today’s holdings no longer show', () => {
    const result = buildAccountHistory({
      ...base,
      securities: [{ securityId: 'sec-bbb', ticker: 'BBB', type: 'equity', isOption: false }],
      holdings: [],
      activity: [
        activity({ date: '2025-01-03', securityId: 'sec-bbb', type: 'sell', subtype: 'sell', quantity: -2, amount: -100, price: 50 }),
      ],
      anchorValue: 100,
      closes: { BBB: [{ date: '2025-01-02', close: 60 }] },
    })

    // Jan 2: 2 shares x 60 + (100 - 100) cash.
    expect(result.points[0]).toMatchObject({ date: '2025-01-02', value: 120 })
  })

  it('takes a deposit out of the account before it, and tracks it apart from market moves', () => {
    const result = buildAccountHistory({
      ...base,
      holdings: [],
      activity: [
        activity({ date: '2025-01-03', securityId: null, type: 'cash', subtype: 'deposit', amount: -300, isCashTransfer: true }),
      ],
      anchorValue: 300,
      closes: {},
    })

    expect(result.points).toEqual([
      { date: '2025-01-02', value: 0, netDeposits: 0 },
      { date: '2025-01-03', value: 300, netDeposits: 300 },
      { date: '2025-01-06', value: 300, netDeposits: 300 },
    ])
  })

  it('fills in a split the institution never reported, from Alpaca’s split list', () => {
    // 2-for-1 on Jan 3. Plaid shows 10 shares today and no split row, so before it there were 5.
    const result = buildAccountHistory({
      ...base,
      holdings: [holding({ quantity: 10, institutionValue: 1000 })],
      activity: [],
      splits: [{ symbol: 'AAA', exDate: '2025-01-03', oldRate: 1, newRate: 2 }],
      anchorValue: 1000,
      closes: { AAA: [{ date: '2025-01-02', close: 200 }, { date: '2025-01-03', close: 99 }] },
    })

    expect(result.points.slice(0, 2).map((p) => p.value)).toEqual([1000, 990])
  })

  it('trusts a split the institution did report, rather than applying it twice', () => {
    const result = buildAccountHistory({
      ...base,
      holdings: [holding({ quantity: 10, institutionValue: 1000 })],
      activity: [activity({ date: '2025-01-03', type: 'transfer', subtype: 'split', quantity: 5 })],
      splits: [{ symbol: 'AAA', exDate: '2025-01-03', oldRate: 1, newRate: 2 }],
      anchorValue: 1000,
      closes: { AAA: [{ date: '2025-01-02', close: 200 }] },
    })

    expect(result.points[0]).toMatchObject({ value: 1000 })
  })

  it('moves no cash for shares delivered outside a trade, whatever amount the row carries', () => {
    // Some institutions report shares arriving (a split paid as a distribution, a transfer in) as a
    // cash-typed deposit with the shares' value as its amount. No cash moved; only units did.
    const result = buildAccountHistory({
      ...base,
      holdings: [holding({ quantity: 10, institutionValue: 1000 })],
      activity: [activity({ date: '2025-01-03', type: 'cash', subtype: 'deposit', quantity: 5, amount: -500 })],
      anchorValue: 1000,
      closes: { AAA: [{ date: '2025-01-02', close: 100 }] },
    })

    // Jan 2: 5 shares x 100, and cash unchanged at 0.
    expect(result.points[0]).toMatchObject({ date: '2025-01-02', value: 500 })
  })

  it('treats shares delivered near a split’s ex-date as the institution reporting that split', () => {
    // The split arrives as a share deposit, not a row typed "split": undoing it again from Alpaca's
    // list would halve the shares twice.
    const result = buildAccountHistory({
      ...base,
      holdings: [holding({ quantity: 10, institutionValue: 1000 })],
      activity: [activity({ date: '2025-01-03', type: 'cash', subtype: 'deposit', quantity: 5 })],
      splits: [{ symbol: 'AAA', exDate: '2025-01-03', oldRate: 1, newRate: 2 }],
      anchorValue: 1000,
      closes: { AAA: [{ date: '2025-01-02', close: 200 }] },
    })

    expect(result.points[0]).toMatchObject({ value: 1000 })
    expect(result.incomplete).toBe(false)
  })

  it('flags history the institution only partly reported, rather than charting negative shares', () => {
    // A sell of 30 when only 10 are held today means the buys before it are missing.
    const result = buildAccountHistory({
      ...base,
      holdings: [holding({ quantity: 10, institutionValue: 1000 })],
      activity: [activity({ date: '2025-01-03', type: 'buy', subtype: 'buy', quantity: 30, amount: 0 })],
      anchorValue: 1000,
      closes: { AAA: [{ date: '2025-01-02', close: 100 }] },
    })

    expect(result.incomplete).toBe(true)
    expect(result.points[0]).toMatchObject({ value: 0 })
  })

  it('holds an unpriced holding flat at today’s price and reports it', () => {
    const result = buildAccountHistory({
      ...base,
      holdings: [holding({ securityId: 'fund', ticker: 'VTSAX', type: 'mutual fund', quantity: 5, institutionValue: 500, institutionPrice: 100 })],
      activity: [],
      anchorValue: 500,
      closes: {},
    })

    expect(result.points.map((p) => p.value)).toEqual([500, 500])
    expect(result.flat).toEqual({ count: 1, value: 500 })
  })

  it('counts a dividend paid on the cash holding as money arriving, though its reinvestment is internal', () => {
    // A money-market core position pays $5 and sweeps it straight back in: $5 more today than before.
    const result = buildAccountHistory({
      ...base,
      holdings: [holding({ securityId: 'cash', ticker: 'CORE', type: 'cash', quantity: 200, institutionValue: 200, institutionPrice: 1 })],
      activity: [
        activity({ date: '2025-01-03', securityId: 'cash', type: 'cash', subtype: 'dividend', amount: -5 }),
        activity({ date: '2025-01-03', securityId: 'cash', type: 'buy', subtype: 'buy', quantity: 5, amount: 5 }),
      ],
      anchorValue: 200,
      closes: {},
    })

    expect(result.points.map((p) => [p.date, p.value])).toEqual([
      ['2025-01-02', 195],
      ['2025-01-03', 200],
      ['2025-01-06', 200],
    ])
  })

  it('ignores activity on a cash holding: moving cash into the cash line is not a trade', () => {
    const result = buildAccountHistory({
      ...base,
      holdings: [holding({ securityId: 'cash', ticker: 'CUR:USD', type: 'cash', quantity: 200, institutionValue: 200, institutionPrice: 1 })],
      activity: [activity({ date: '2025-01-03', securityId: 'cash', type: 'buy', subtype: 'buy', quantity: 200, amount: 200 })],
      anchorValue: 200,
      closes: {},
    })

    expect(result.points.map((p) => p.value)).toEqual([200, 200])
    expect(result.flat.count).toBe(0)
  })
})

describe('rangeGain', () => {
  const points = [
    { date: '2025-01-02', value: 1000, netDeposits: 0 },
    { date: '2025-01-03', value: 1600, netDeposits: 500 },
    { date: '2025-01-06', value: 1700, netDeposits: 500 },
  ]

  it('is the change in value less the money deposited, over the money the range had to work with', () => {
    // Jan 3's jump is mostly a $500 deposit: money put in, not gained. Base: 1000 opening + 500 in.
    expect(rangeGain(points, '2025-01-01')).toEqual({ gain: 200, pct: 200 / 1500 })
  })

  it('counts a deposit in the base in full, whenever in the range it arrived', () => {
    // The headline's total return has no timing weighting either, so the two agree.
    const late = [
      { date: '2025-01-02', value: 1000, netDeposits: 0 },
      { date: '2025-01-06', value: 11100, netDeposits: 10000 },
    ]
    expect(rangeGain(late, '2025-01-01')).toEqual({ gain: 100, pct: 100 / 11000 })
  })

  it('takes a withdrawal out of the base', () => {
    const out = [
      { date: '2025-01-02', value: 1000, netDeposits: 0 },
      { date: '2025-01-04', value: 520, netDeposits: -500 },
      { date: '2025-01-06', value: 540, netDeposits: -500 },
    ]
    // Gain 540 - 1000 + 500 = 40, on 1000 - 500 = 500.
    expect(rangeGain(out, '2025-01-01')).toEqual({ gain: 40, pct: 0.08 })
  })

  it('has no percentage once more has been taken out than the range opened with and put in', () => {
    const drained = [
      { date: '2025-01-02', value: 1000, netDeposits: 0 },
      { date: '2025-01-06', value: 10, netDeposits: -1000 },
    ]
    expect(rangeGain(drained, '2025-01-01')).toEqual({ gain: 10, pct: null })
  })

  it('measures from the first point inside the range', () => {
    expect(rangeGain(points, '2025-01-03')).toEqual({ gain: 100, pct: 100 / 1600 })
  })

  it('is null with fewer than two points to compare', () => {
    expect(rangeGain(points, '2025-01-06')).toBeNull()
  })
})

describe('windowReading', () => {
  const visible = [
    { date: '2025-01-02', value: 1000, netDeposits: 0 },
    { date: '2025-01-03', value: 1600, netDeposits: 500 },
    { date: '2025-01-06', value: 1700, netDeposits: 500 },
  ]

  it('reads the latest point in view when nothing is selected, gained since the window opened', async () => {
    const { windowReading } = await import('./accountHistory')
    expect(windowReading(visible, null)).toEqual({ value: 1700, gain: { gain: 200, pct: 200 / 1500 } })
  })

  it('reads the selected point, gained from the window’s opening up to it', async () => {
    const { windowReading } = await import('./accountHistory')
    expect(windowReading(visible, 1)).toEqual({ value: 1600, gain: { gain: 100, pct: 100 / 1500 } })
  })

  it('has a value but no gain when the selection is the window’s first point', async () => {
    const { windowReading } = await import('./accountHistory')
    expect(windowReading(visible, 0)).toEqual({ value: 1000, gain: null })
  })

  it('falls back to the latest point when the selection is out of range', async () => {
    const { windowReading } = await import('./accountHistory')
    expect(windowReading(visible, 7)?.value).toBe(1700)
  })

  it('is null for an empty window', async () => {
    const { windowReading } = await import('./accountHistory')
    expect(windowReading([], null)).toBeNull()
  })
})

describe('cashFlowMarkers', () => {
  const dates = ['2025-01-02', '2025-01-03', '2025-01-06']

  it('marks each day’s deposits and withdrawals apart, summed, from money crossing the account', async () => {
    const { cashFlowMarkers } = await import('./accountHistory')
    const markers = cashFlowMarkers(
      [
        activity({ date: '2025-01-03', securityId: null, type: 'cash', subtype: 'deposit', amount: -300, isCashTransfer: true }),
        activity({ date: '2025-01-03', securityId: null, type: 'cash', subtype: 'deposit', amount: -200, isCashTransfer: true }),
        activity({ date: '2025-01-06', securityId: null, type: 'cash', subtype: 'withdrawal', amount: 150, isCashTransfer: true }),
        // A trade moves money inside the account, not across it.
        activity({ date: '2025-01-03', type: 'buy', subtype: 'buy', quantity: 1, amount: 100 }),
      ],
      dates,
    )

    expect(markers).toEqual([
      { index: 1, kind: 'deposit', amount: 500 },
      { index: 2, kind: 'withdrawal', amount: 150 },
    ])
  })

  it('drops flows outside the window', async () => {
    const { cashFlowMarkers } = await import('./accountHistory')
    expect(
      cashFlowMarkers([activity({ date: '2024-12-01', securityId: null, amount: -10, isCashTransfer: true })], dates),
    ).toEqual([])
  })
})

describe('fillCalendarDays', () => {
  it('gives every calendar day a point, carrying the last value over weekends and holidays', async () => {
    const { fillCalendarDays } = await import('./accountHistory')
    // Friday, then Monday.
    const filled = fillCalendarDays([
      { date: '2025-01-03', value: 100, netDeposits: 0 },
      { date: '2025-01-06', value: 110, netDeposits: 50 },
    ])

    expect(filled).toEqual([
      { date: '2025-01-03', value: 100, netDeposits: 0 },
      { date: '2025-01-04', value: 100, netDeposits: 0 },
      { date: '2025-01-05', value: 100, netDeposits: 0 },
      { date: '2025-01-06', value: 110, netDeposits: 50 },
    ])
  })

  it('keeps a series that already has every day as it is', async () => {
    const { fillCalendarDays } = await import('./accountHistory')
    const points = [
      { date: '2025-01-03', price: 1 },
      { date: '2025-01-04', price: 2 },
    ]
    expect(fillCalendarDays(points)).toEqual(points)
  })

  it('is empty for an empty series', async () => {
    const { fillCalendarDays } = await import('./accountHistory')
    expect(fillCalendarDays([])).toEqual([])
  })
})
