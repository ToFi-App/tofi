import { priceableSymbol } from './accountHistory'
import type { Holding, LatestPrice } from '@/types/domain'

function round2(value: number): number {
  return Math.round(value * 100) / 100
}

function valueOf(holding: Holding): number {
  return holding.institutionValue ?? holding.quantity * (holding.institutionPrice ?? 0)
}

/** Whether a trade at `at` is more recent than the institution's price. Undated loses to any trade. */
function isNewer(at: string, priceAsOf: string | null): boolean {
  if (!priceAsOf) return true
  return Date.parse(at) > Date.parse(priceAsOf)
}

/**
 * Holdings repriced at the market's latest trade: the institution's share count times Alpaca's
 * price. The institution still owns everything it alone knows — quantity, cost basis — and keeps
 * its price wherever it is the fresher one: a weekend, or a thinly traded fund whose last trade on
 * the free feed is older than the institution's own close.
 *
 * `priceAsOf` follows the price that was used, so the sheet's "Updated" label (the OLDEST date
 * across holdings, see holdingsPricedAsOf) stays honest when some positions are live and others
 * aren't. Untouched holdings come back as the same objects.
 */
export function applyLivePrices(holdings: Holding[], prices: Record<string, LatestPrice>): Holding[] {
  return holdings.map((holding) => {
    const symbol = priceableSymbol({ ticker: holding.ticker, type: holding.type, isOption: holding.optionContract != null })
    const quote = symbol ? prices[symbol] : undefined
    if (!quote || !isNewer(quote.at, holding.priceAsOf)) return holding
    return {
      ...holding,
      institutionPrice: quote.price,
      institutionValue: round2(holding.quantity * quote.price),
      priceAsOf: quote.at,
    }
  })
}

/**
 * The account's balance with its holdings repriced: the institution's balance moved by exactly what
 * repricing moved them. Built as a delta rather than a fresh sum so cash, and anything the
 * institution counts that it doesn't list as a holding, stay in the total as it reported them.
 */
export function liveBalance(balance: number, plaid: Holding[], live: Holding[]): number {
  let delta = 0
  for (let i = 0; i < plaid.length; i++) {
    if (live[i] !== plaid[i]) delta += valueOf(live[i]) - valueOf(plaid[i])
  }
  return round2(balance + delta)
}
