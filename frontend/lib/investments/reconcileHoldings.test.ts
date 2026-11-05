import { describe, expect, it } from 'vitest'
import { applyUnreflectedTrades, reconcileAccount } from './reconcileHoldings'
import type { Holding, InvestmentActivity } from '@/types/domain'

const TODAY = '2026-08-10'

function holding(overrides: Partial<Holding>): Holding {
  return {
    securityId: 'sec-a',
    name: 'Alpha',
    ticker: 'AAA',
    type: 'equity',
    quantity: 10,
    institutionValue: 200,
    costBasis: 150,
    institutionPrice: 20,
    closePrice: 20,
    priceAsOf: TODAY,
    optionContract: null,
    isoCurrencyCode: 'USD',
    ...overrides,
  } as Holding
}

function buy(date: string, quantity: number, amount: number): InvestmentActivity {
  return { investmentTransactionId: `b-${date}-${quantity}`, date, securityId: 'sec-a', type: 'buy', subtype: 'buy', quantity, amount, price: amount / quantity, isCashTransfer: false } as InvestmentActivity
}

function sell(date: string, quantity: number, amount: number): InvestmentActivity {
  return { investmentTransactionId: `s-${date}-${quantity}`, date, securityId: 'sec-a', type: 'sell', subtype: 'sell', quantity: -quantity, amount: -amount, price: amount / quantity, isCashTransfer: false } as InvestmentActivity
}

describe('applyUnreflectedTrades', () => {
  it('drops a position whose recent sale the holding still predates', () => {
    // Bought 6 then 4, sold all 10 yesterday; the brokerage still lists 10.
    const activity = [buy('2026-05-01', 6, 90), buy('2026-06-01', 4, 60), sell('2026-08-09', 10, 210)]
    expect(applyUnreflectedTrades([holding({})], activity, TODAY)).toEqual([])
  })

  it('leaves a holding whose trades already add up to it', () => {
    const holdings = [holding({})]
    const activity = [buy('2026-05-01', 6, 90), buy('2026-08-09', 4, 60)]
    expect(applyUnreflectedTrades(holdings, activity, TODAY)).toBe(holdings)
  })

  it('shrinks a partly sold position, keeping its average cost', () => {
    const activity = [buy('2026-05-01', 10, 150), sell('2026-08-08', 4, 84)]
    const [after] = applyUnreflectedTrades([holding({})], activity, TODAY)
    expect(after.quantity).toBe(6)
    expect(after.institutionValue).toBe(120)
    expect(after.costBasis).toBe(90)
  })

  it('grows a position added to, adding what the shares cost', () => {
    const activity = [buy('2026-05-01', 10, 150), buy('2026-08-09', 5, 110)]
    const [after] = applyUnreflectedTrades([holding({})], activity, TODAY)
    expect(after.quantity).toBe(15)
    expect(after.institutionValue).toBe(300)
    expect(after.costBasis).toBe(260)
  })

  it('leaves a holding alone when no recent cut explains the difference', () => {
    // Held since before the trade history: the trades sum to 4, the holding has 10.
    const holdings = [holding({})]
    expect(applyUnreflectedTrades(holdings, [buy('2026-08-09', 4, 80)], TODAY)).toBe(holdings)
  })

  it('only treats recent trades as missing', () => {
    // The same gap, but the unexplained sale is weeks old: not the brokerage running a day behind.
    const holdings = [holding({})]
    const activity = [buy('2026-05-01', 10, 150), sell('2026-07-01', 10, 210)]
    expect(applyUnreflectedTrades(holdings, activity, TODAY)).toBe(holdings)
  })

  it('reads a sell as a sale whichever sign the institution gives its quantity', () => {
    const activity = [buy('2026-05-01', 10, 150), { ...sell('2026-08-09', 10, 210), quantity: 10 }]
    expect(applyUnreflectedTrades([holding({})], activity, TODAY)).toEqual([])
  })

  it('touches only the securities whose trades disagree with them', () => {
    const other = holding({ securityId: 'sec-b', ticker: 'BBB' })
    const activity = [buy('2026-05-01', 10, 150), sell('2026-08-09', 10, 210)]
    expect(applyUnreflectedTrades([holding({}), other], activity, TODAY)).toEqual([other])
  })
})

describe('reconcileAccount', () => {
  it('reports the cash the missing trades moved: a sale adds its proceeds', () => {
    const activity = [buy('2026-05-01', 10, 150), sell('2026-08-09', 10, 210)]
    expect(reconcileAccount([holding({})], activity, TODAY)).toEqual({ holdings: [], cashDelta: 210 })
  })

  it('takes a missing purchase out of cash', () => {
    const activity = [buy('2026-05-01', 10, 150), buy('2026-08-09', 5, 110)]
    expect(reconcileAccount([holding({})], activity, TODAY).cashDelta).toBe(-110)
  })

  it('moves no cash when nothing is missing', () => {
    const holdings = [holding({})]
    expect(reconcileAccount(holdings, [buy('2026-05-01', 10, 150)], TODAY)).toEqual({ holdings, cashDelta: 0 })
  })
})
