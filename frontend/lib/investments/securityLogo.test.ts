import { describe, expect, it } from 'vitest'
import { securityLogoUrl } from './securityLogo'

type Security = Parameters<typeof securityLogoUrl>[0]

function security(overrides: Partial<Security>): Security {
  return { ticker: 'AAA', type: 'equity', optionContract: null, ...overrides } as Security
}

const ID = 'pk_test'

describe('securityLogoUrl', () => {
  it('looks a stock up by ticker, sized for a 3x screen', () => {
    expect(securityLogoUrl(security({ ticker: 'AAA' }), ID)).toBe(
      'https://img.logo.dev/ticker/AAA?token=pk_test&size=48&retina=true&format=png',
    )
  })

  it('covers ETFs, funds and dotted share classes', () => {
    expect(securityLogoUrl(security({ ticker: 'BBB', type: 'etf' }), ID)).toContain('/ticker/BBB?')
    expect(securityLogoUrl(security({ ticker: 'CCCXX', type: 'mutual fund' }), ID)).toContain('/ticker/CCCXX?')
    expect(securityLogoUrl(security({ ticker: 'DD.B' }), ID)).toContain('/ticker/DD.B?')
  })

  it('shows an option as the company it is written on', () => {
    const option = security({
      ticker: 'AAA260116C00100000',
      type: 'derivative',
      optionContract: { underlyingTicker: 'AAA', contractType: 'call', strikePrice: 100 },
    })
    expect(securityLogoUrl(option, ID)).toContain('/ticker/AAA?')
    expect(securityLogoUrl({ ...option, optionContract: { ...option.optionContract!, underlyingTicker: null } }, ID)).toBeNull()
  })

  it('routes crypto to the crypto lookup, with or without a currency prefix', () => {
    expect(securityLogoUrl(security({ ticker: 'BTC', type: 'cryptocurrency' }), ID)).toContain('/crypto/BTC?')
    expect(securityLogoUrl(security({ ticker: 'CUR:ETH', type: 'cryptocurrency' }), ID)).toContain('/crypto/ETH?')
  })

  it('keeps the monogram for cash, missing tickers and unknown types', () => {
    expect(securityLogoUrl(security({ ticker: 'CUR:USD', type: 'cash' }), ID)).toBeNull()
    expect(securityLogoUrl(security({ ticker: null }), ID)).toBeNull()
    expect(securityLogoUrl(security({ ticker: 'AAA', type: 'fixed income' }), ID)).toBeNull()
    expect(securityLogoUrl(security({ ticker: 'AAA', type: null }), ID)).toBeNull()
  })

  it('makes no request without a key', () => {
    expect(securityLogoUrl(security({ ticker: 'AAA' }), '')).toBeNull()
    expect(securityLogoUrl(security({ ticker: 'AAA' }), '   ')).toBeNull()
  })
})
