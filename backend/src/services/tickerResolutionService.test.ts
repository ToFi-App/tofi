import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AlpacaClient, LatestPrice, TickerChange } from '../lib/alpaca/client.js'
import type { Holding } from '../repositories/investmentRepository.js'
import { clearTickerChangeCache, decideTicker, followChain, resolveHoldingTickers } from './tickerResolutionService.js'

// Symbols and dates are the real history; prices and CUSIPs are illustrative.
const TODAY = '2026-11-07'

/** Atlas Crest (ACIC) became Archer (ACHR) in 2021; American Coastal took ACIC over in 2023. */
const ACIC_TO_ACHR: TickerChange = { fromSymbol: 'ACIC', toSymbol: 'ACHR', fromCusip: 'CUSIP-ATLAS', toCusip: 'CUSIP-ARCHER', date: '2021-09-17' }
const UIHC_TO_ACIC: TickerChange = { fromSymbol: 'UIHC', toSymbol: 'ACIC', fromCusip: 'CUSIP-UIHC', toCusip: 'CUSIP-AMCOASTAL', date: '2023-01-04' }
/** dMY Technology III (DMYI) became IonQ (IONQ) in 2021; the symbol was never reused. */
const DMYI_TO_IONQ: TickerChange = { fromSymbol: 'DMYI', toSymbol: 'IONQ', fromCusip: 'CUSIP-DMY', toCusip: 'CUSIP-IONQ', date: '2021-10-01' }

function quote(price: number, at = `${TODAY}T15:30:00Z`): LatestPrice {
  return { price, at }
}

describe('followChain', () => {
  it('follows a rename and ignores the later reuse of the symbol', () => {
    expect(followChain('ACIC', [ACIC_TO_ACHR, UIHC_TO_ACIC]).map((c) => c.toSymbol)).toEqual(['ACHR'])
  })

  it('follows a chain of renames in date order', () => {
    const a: TickerChange = { fromSymbol: 'AAA', toSymbol: 'BBB', fromCusip: null, toCusip: null, date: '2020-01-01' }
    const b: TickerChange = { fromSymbol: 'BBB', toSymbol: 'CCC', fromCusip: null, toCusip: null, date: '2022-01-01' }
    expect(followChain('AAA', [b, a]).map((c) => c.toSymbol)).toEqual(['BBB', 'CCC'])
  })

  it('is empty for a symbol that never moved', () => {
    expect(followChain('AAPL', [ACIC_TO_ACHR])).toEqual([])
  })
})

describe('decideTicker', () => {
  const changes = [ACIC_TO_ACHR, UIHC_TO_ACIC, DMYI_TO_IONQ]

  it('maps a stale ACIC holding to ACHR when the institution prices it like Archer', () => {
    const quotes = { ACIC: quote(11.4), ACHR: quote(8.2) }
    expect(decideTicker({ ticker: 'ACIC', cusip: null, institutionPrice: 8.05 }, changes, quotes, TODAY)).toEqual({
      ticker: 'ACHR',
      marketPriceTrusted: true,
    })
  })

  it('keeps ACIC for someone who really holds American Coastal', () => {
    const quotes = { ACIC: quote(11.4), ACHR: quote(8.2) }
    expect(decideTicker({ ticker: 'ACIC', cusip: null, institutionPrice: 11.3 }, changes, quotes, TODAY)).toEqual({
      ticker: 'ACIC',
      marketPriceTrusted: true,
    })
  })

  it('lets a CUSIP decide even when the two prices are close', () => {
    const quotes = { ACIC: quote(10.1), ACHR: quote(10.0) }
    expect(decideTicker({ ticker: 'ACIC', cusip: 'CUSIP-ATLAS', institutionPrice: 10.1 }, changes, quotes, TODAY).ticker).toBe('ACHR')
    expect(decideTicker({ ticker: 'ACIC', cusip: 'CUSIP-AMCOASTAL', institutionPrice: 10.0 }, changes, quotes, TODAY).ticker).toBe('ACIC')
  })

  it('distrusts the market price when neither symbol fits the institution price on a reused ticker', () => {
    const quotes = { ACIC: quote(11.4), ACHR: quote(8.2) }
    expect(decideTicker({ ticker: 'ACIC', cusip: null, institutionPrice: 40 }, changes, quotes, TODAY)).toEqual({
      ticker: 'ACIC',
      marketPriceTrusted: false,
    })
  })

  it('maps DMYI to IONQ, ignoring the retired symbol\'s 2021 last trade', () => {
    const quotes = { DMYI: quote(9.8, '2021-09-30T19:59:00Z'), IONQ: quote(42.5) }
    expect(decideTicker({ ticker: 'DMYI', cusip: null, institutionPrice: 41.9 }, changes, quotes, TODAY)).toEqual({
      ticker: 'IONQ',
      marketPriceTrusted: true,
    })
  })

  it('maps DMYI to IONQ without an institution price, since nobody else took the symbol', () => {
    expect(decideTicker({ ticker: 'DMYI', cusip: null, institutionPrice: null }, changes, { IONQ: quote(42.5) }, TODAY)).toEqual({
      ticker: 'IONQ',
      marketPriceTrusted: true,
    })
  })

  it('still relabels a retired symbol whose successor price does not fit, but keeps the institution price', () => {
    const quotes = { IONQ: quote(42.5) }
    expect(decideTicker({ ticker: 'DMYI', cusip: null, institutionPrice: 10 }, changes, quotes, TODAY)).toEqual({
      ticker: 'IONQ',
      marketPriceTrusted: false,
    })
  })

  it('cannot pick between two owners of a reused ticker without a price, so trusts neither', () => {
    expect(decideTicker({ ticker: 'ACIC', cusip: null, institutionPrice: null }, changes, { ACIC: quote(11.4) }, TODAY)).toEqual({
      ticker: 'ACIC',
      marketPriceTrusted: false,
    })
  })

  it('leaves an ordinary ticker alone', () => {
    expect(decideTicker({ ticker: 'AAPL', cusip: null, institutionPrice: 230 }, changes, { AAPL: quote(231) }, TODAY)).toEqual({
      ticker: 'AAPL',
      marketPriceTrusted: true,
    })
  })

  it('distrusts an unmoved ticker whose market price contradicts the institution', () => {
    expect(decideTicker({ ticker: 'XYZ', cusip: null, institutionPrice: 8 }, changes, { XYZ: quote(30) }, TODAY)).toEqual({
      ticker: 'XYZ',
      marketPriceTrusted: false,
    })
  })

  it('trusts an unmoved ticker Alpaca has no quote for: the institution price stays anyway', () => {
    expect(decideTicker({ ticker: 'XYZ', cusip: null, institutionPrice: 8 }, changes, {}, TODAY).marketPriceTrusted).toBe(true)
  })
})

function holding(overrides: Partial<Holding>): Holding {
  return {
    securityId: 'sec',
    name: null,
    ticker: null,
    cusip: null,
    type: 'equity',
    quantity: 10,
    institutionValue: null,
    costBasis: null,
    institutionPrice: null,
    closePrice: null,
    priceAsOf: null,
    optionContract: null,
    isoCurrencyCode: 'USD',
    ...overrides,
  }
}

function fakeAlpaca(changes: TickerChange[], quotes: Record<string, LatestPrice>) {
  return {
    getTickerChanges: vi.fn(async (symbols: string[]) =>
      changes.filter((c) => symbols.includes(c.fromSymbol) || symbols.includes(c.toSymbol)),
    ),
    getLatestPrices: vi.fn(async (symbols: string[]) => Object.fromEntries(symbols.filter((s) => quotes[s]).map((s) => [s, quotes[s]]))),
  }
}

describe('resolveHoldingTickers', () => {
  beforeEach(() => clearTickerChangeCache())

  it('corrects ACIC and DMYI, keeps Plaid\'s ticker alongside, and leaves the rest untouched', async () => {
    const alpaca = fakeAlpaca([ACIC_TO_ACHR, UIHC_TO_ACIC, DMYI_TO_IONQ], {
      ACIC: quote(11.4),
      ACHR: quote(8.2),
      IONQ: quote(42.5),
      AAPL: quote(231),
    })
    const cash = holding({ securityId: 'cash', ticker: 'CUR:USD', type: 'cash' })
    const aapl = holding({ securityId: 'aapl', ticker: 'AAPL', institutionPrice: 230 })
    const result = await resolveHoldingTickers(
      [
        holding({ securityId: 'achr', ticker: 'ACIC', institutionPrice: 8.05 }),
        holding({ securityId: 'ionq', ticker: 'DMYI', institutionPrice: 41.9 }),
        aapl,
        cash,
      ],
      alpaca as unknown as AlpacaClient,
      TODAY,
    )

    expect(result[0]).toMatchObject({ ticker: 'ACHR', plaidTicker: 'ACIC', marketPriceTrusted: true })
    expect(result[1]).toMatchObject({ ticker: 'IONQ', plaidTicker: 'DMYI', marketPriceTrusted: true })
    expect(result[2]).toBe(aapl)
    expect(result[3]).toBe(cash)
    // The successors are priced too, and the cash line never reaches Alpaca.
    expect(alpaca.getLatestPrices.mock.calls[0][0].sort()).toEqual(['AAPL', 'ACHR', 'ACIC', 'DMYI', 'IONQ'])
  })

  it('caches ticker changes, so a second account costs no corporate-actions call', async () => {
    const alpaca = fakeAlpaca([DMYI_TO_IONQ], { IONQ: quote(42.5) })
    await resolveHoldingTickers([holding({ ticker: 'DMYI', institutionPrice: 42 })], alpaca as unknown as AlpacaClient, TODAY)
    await resolveHoldingTickers([holding({ ticker: 'DMYI', institutionPrice: 42 })], alpaca as unknown as AlpacaClient, TODAY)
    // Round one asks about DMYI, round two about IONQ; the second resolve asks about neither.
    expect(alpaca.getTickerChanges).toHaveBeenCalledTimes(2)
  })

  it('returns Plaid\'s holdings unchanged when Alpaca fails', async () => {
    const alpaca = {
      getTickerChanges: vi.fn(async () => {
        throw new Error('Alpaca /v1/corporate-actions failed with 500')
      }),
      getLatestPrices: vi.fn(),
    }
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const holdings = [holding({ ticker: 'ACIC', institutionPrice: 8 })]
    expect(await resolveHoldingTickers(holdings, alpaca as unknown as AlpacaClient, TODAY)).toBe(holdings)
  })
})
