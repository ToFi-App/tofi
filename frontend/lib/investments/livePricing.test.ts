import { describe, expect, it } from 'vitest'
import { applyLivePrices, liveBalance } from './livePricing'
import type { Holding } from '@/types/domain'

function holding(overrides: Partial<Holding>): Holding {
  return {
    securityId: 'sec-aaa',
    name: 'Example',
    ticker: 'AAA',
    type: 'equity',
    quantity: 10,
    institutionValue: 1000,
    costBasis: 800,
    institutionPrice: 100,
    closePrice: null,
    priceAsOf: '2025-01-05',
    optionContract: null,
    isoCurrencyCode: 'USD',
    ...overrides,
  }
}

describe('applyLivePrices', () => {
  it('reprices a holding at a newer trade: Plaid’s shares times the market’s price', () => {
    const [live] = applyLivePrices([holding({})], { AAA: { price: 105.5, at: '2025-01-06T20:59:58Z' } })

    expect(live).toMatchObject({ institutionPrice: 105.5, institutionValue: 1055, priceAsOf: '2025-01-06T20:59:58Z' })
    // Basis is the institution's and never moves with price.
    expect(live.costBasis).toBe(800)
  })

  it('keeps the institution’s price when it is newer than the last trade', () => {
    const plaid = holding({ priceAsOf: '2025-01-06T21:00:00Z' })
    const [kept] = applyLivePrices([plaid], { AAA: { price: 105.5, at: '2025-01-06T18:00:00Z' } })

    expect(kept).toBe(plaid)
  })

  it('reprices an undated holding, since any dated trade is newer than an unknown', () => {
    const [live] = applyLivePrices([holding({ priceAsOf: null })], { AAA: { price: 99, at: '2025-01-06T20:00:00Z' } })

    expect(live.institutionValue).toBe(990)
  })

  it('leaves alone what Alpaca does not price, even under a matching ticker', () => {
    const fund = holding({ ticker: 'AAA', type: 'mutual fund' })
    const [kept] = applyLivePrices([fund], { AAA: { price: 105.5, at: '2025-01-06T20:59:58Z' } })

    expect(kept).toBe(fund)
  })

  it('leaves alone a holding with no quote', () => {
    const plaid = holding({})
    expect(applyLivePrices([plaid], {})[0]).toBe(plaid)
  })
})

describe('liveBalance', () => {
  it('moves the institution’s balance by exactly what repricing moved the holdings', () => {
    // Cash and anything unpriced stay inside the balance untouched.
    const plaid = [holding({ institutionValue: 600 }), holding({ securityId: 'cash', type: 'cash', institutionValue: 400 })]
    const live = [holding({ institutionValue: 660 }), plaid[1]]

    expect(liveBalance(1000, plaid, live)).toBe(1060)
  })

  it('is the institution’s balance when nothing was repriced', () => {
    const plaid = [holding({})]
    expect(liveBalance(1000, plaid, plaid)).toBe(1000)
  })
})
