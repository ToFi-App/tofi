import type { Holding } from '@/types/domain'

const CDN = 'https://img.logo.dev'
/** In points, half the pixels `retina` asks for: 48 -> 96px, enough for the 32pt mark at 3x. */
const SIZE = 48
/** A plain exchange symbol. Cash ("CUR:USD") and raw OCC option strings fail it. */
const SYMBOL = /^[A-Z][A-Z0-9.-]{0,9}$/
const TICKER_TYPES = new Set(['equity', 'etf', 'mutual fund'])

type Security = Pick<Holding, 'ticker' | 'type' | 'optionContract'>

/**
 * A security's logo on Logo.dev's CDN, looked up by ticker; null keeps the monogram. Plaid
 * ships no security logos, so this is the only source.
 *
 * The ticker lookup resolves funds to their issuer (a Direxion ETF shows Direxion), and a ticker
 * with no logo gets the CDN's own letter icon — its default fallback — so every looked-up
 * holding gets a mark in the same style. No key (an unset env var) means no request at all.
 */
export function securityLogoUrl(
  security: Security,
  key: string | undefined = process.env.EXPO_PUBLIC_LOGO_DEV_KEY,
): string | null {
  const token = key?.trim()
  if (!token) return null
  const route = logoRoute(security)
  if (!route) return null
  return `${CDN}/${route}?token=${encodeURIComponent(token)}&size=${SIZE}&retina=true&format=png`
}

function logoRoute({ ticker, type, optionContract }: Security): string | null {
  // An option wears the company it's written on: an AAPL call shows Apple.
  if (optionContract) {
    const underlying = optionContract.underlyingTicker
    return underlying && SYMBOL.test(underlying) ? `ticker/${underlying}` : null
  }
  if (!ticker) return null
  if (type === 'cryptocurrency') {
    const coin = ticker.replace(/^CUR:/, '')
    return SYMBOL.test(coin) ? `crypto/${coin}` : null
  }
  return type && TICKER_TYPES.has(type) && SYMBOL.test(ticker) ? `ticker/${ticker}` : null
}
