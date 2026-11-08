import type { AlpacaClient, DailyClose, LatestPrice, TickerChange } from '../lib/alpaca/client.js'
import type { ActivitySecurity, Holding, InvestmentActivity } from '../repositories/investmentRepository.js'

/**
 * Plaid's security catalog can keep a ticker long after the market moved it. A SPAC that merged
 * keeps the SPAC's symbol — Archer Aviation still arrives as ACIC (Atlas Crest), IonQ as DMYI
 * (dMY Technology III) — and a retired symbol can be handed to an unrelated company: ACIC is now
 * American Coastal Insurance. Asking Alpaca for Plaid's ticker then prices the position as a
 * different stock, or as nothing at all.
 *
 * Nothing here is a hand-kept list. Two facts settle each holding:
 *  - Alpaca's corporate actions, which name every rename and stock merger a symbol went through;
 *  - the institution's own price, which is right even when the ticker is not — it is what the
 *    brokerage itself values the shares at. A candidate symbol whose market price is nowhere near
 *    it is not this security.
 * A CUSIP, when Plaid has one, decides before price does.
 */

/** How far back renames are looked for. De-SPACs that left a stale ticker in Plaid date from 2020-21. */
export const TICKER_CHANGES_SINCE = '2015-01-01'

/**
 * How far a market price may sit from the institution's and still be the same security. Wide on
 * purpose: the institution's price can be a day or two old, and the stocks this matters for —
 * recent de-SPACs — move fast. A real mismatch (another company entirely) is rarely this close,
 * and a miss here only falls back to the institution's price.
 */
export const PRICE_TOLERANCE = 1.35

/** A last trade older than this is a delisted or retired symbol, not a market price. */
export const STALE_QUOTE_DAYS = 30

/**
 * How far before a trade the nearest close may sit and still price it: a weekend plus a holiday,
 * with room for a thin IEX day.
 */
export const TRADE_CLOSE_WINDOW_DAYS = 7

/** Renames followed from one symbol before giving up: real chains are one or two long. */
const MAX_CHAIN = 5

/** Holding types Alpaca prices, mirroring the client's PRICEABLE_TYPES. */
const PRICEABLE_TYPES = new Set(['equity', 'etf'])
const ALPACA_SYMBOL = /^[A-Z][A-Z0-9.]{0,9}$/

export interface TickerDecision {
  /** The symbol the security trades under today: shown to the user and asked of Alpaca. */
  ticker: string
  /**
   * Whether Alpaca's price for `ticker` may replace the institution's. False when the symbol could
   * not be tied to this security, so a stranger's price never stands in for it.
   */
  marketPriceTrusted: boolean
}

interface SecurityFacts {
  ticker: string
  cusip: string | null
  institutionPrice: number | null
}

function daysBetween(a: string, b: string): number {
  return Math.abs(Date.parse(a) - Date.parse(b)) / 86_400_000
}

function freshPrice(quote: LatestPrice | undefined, today: string): number | null {
  if (!quote || !(quote.price > 0)) return null
  if (daysBetween(quote.at.slice(0, 10), today) > STALE_QUOTE_DAYS) return null
  return quote.price
}

function priceMatches(market: number, institution: number): boolean {
  const ratio = market / institution
  return ratio <= PRICE_TOLERANCE && ratio >= 1 / PRICE_TOLERANCE
}

/** The renames `symbol` went through, oldest first, each starting after the last. */
export function followChain(symbol: string, changes: TickerChange[]): TickerChange[] {
  const chain: TickerChange[] = []
  let current = symbol
  let after = ''
  for (let i = 0; i < MAX_CHAIN; i++) {
    const next = changes
      .filter((c) => c.fromSymbol === current && c.date >= after && c.toSymbol !== symbol)
      .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))[0]
    if (!next) break
    chain.push(next)
    current = next.toSymbol
    after = next.date
  }
  return chain
}

/**
 * Which symbol this security trades under now, and whether its market price can be trusted.
 *
 * `referencePrice` is a price known to be this security's — the institution's price for a holding,
 * a trade's own price for a sold position — and `marketPrice` gives a candidate symbol's market
 * price at the same moment (today's quote, or the close on that trade's date), null when it has
 * none. Pure: every fact it needs is passed in, so each case below is pinned by a test.
 */
export function decideTickerAgainst(
  security: { ticker: string; cusip: string | null; referencePrice: number | null },
  changes: TickerChange[],
  marketPrice: (symbol: string) => number | null,
): TickerDecision {
  const { ticker, cusip, referencePrice } = security
  const chain = followChain(ticker, changes)
  const ownPrice = marketPrice(ticker)
  const reference = referencePrice != null && referencePrice > 0 ? referencePrice : null

  if (chain.length === 0) {
    // The common case: the ticker never moved. Trust its price unless it contradicts the
    // reference, which catches a stale symbol Alpaca has no rename for.
    const trusted = ownPrice == null || reference == null || priceMatches(ownPrice, reference)
    return { ticker, marketPriceTrusted: trusted }
  }

  const successor = chain[chain.length - 1].toSymbol
  const departedOn = chain[0].date
  // Someone renamed INTO this symbol after it was vacated: the ticker now names a different company,
  // and the holder could own either one.
  const reassignedTo = changes.find((c) => c.toSymbol === ticker && c.date > departedOn)

  // A CUSIP names one security for good, so it settles the question before any price does.
  if (cusip) {
    if (chain.some((c) => c.fromCusip === cusip)) return checked(successor)
    if (reassignedTo?.toCusip === cusip) return checked(ticker)
  }

  if (reference != null) {
    const candidates = [ticker, successor]
      .map((symbol) => ({ symbol, price: marketPrice(symbol) }))
      .filter((c): c is { symbol: string; price: number } => c.price != null && priceMatches(c.price, reference))
      .sort((a, b) => Math.abs(Math.log(a.price / reference)) - Math.abs(Math.log(b.price / reference)))
    if (candidates.length > 0) return { ticker: candidates[0].symbol, marketPriceTrusted: true }
    // Neither symbol's price fits. A retired, never-reused ticker still moved for sure; one that
    // was handed on can't be told apart. Either way the reference price stays.
    return { ticker: reassignedTo || ownPrice != null ? ticker : successor, marketPriceTrusted: false }
  }

  // No reference price to compare against. A vacated symbol nobody took is unambiguous.
  if (!reassignedTo && ownPrice == null) return { ticker: successor, marketPriceTrusted: true }
  return { ticker, marketPriceTrusted: false }

  function checked(symbol: string): TickerDecision {
    const price = marketPrice(symbol)
    return { ticker: symbol, marketPriceTrusted: price == null || reference == null || priceMatches(price, reference) }
  }
}

/** `decideTickerAgainst` for a holding: the institution's price against today's quotes. */
export function decideTicker(
  security: SecurityFacts,
  changes: TickerChange[],
  quotes: Record<string, LatestPrice>,
  today: string,
): TickerDecision {
  return decideTickerAgainst(
    { ticker: security.ticker, cusip: security.cusip, referencePrice: security.institutionPrice },
    changes,
    (symbol) => freshPrice(quotes[symbol], today),
  )
}

/** Ticker changes per symbol, kept for a day: renames are permanent, so one lookup serves everyone. */
const CHANGES_TTL_MS = 24 * 60 * 60 * 1000
const changesCache = new Map<string, { changes: TickerChange[]; at: number }>()

/** Only for tests: the cache is module state shared across a warm serverless instance. */
export function clearTickerChangeCache(): void {
  changesCache.clear()
  namesCache.clear()
}

/** Company names per symbol, kept for a day like the ticker changes they follow. */
const namesCache = new Map<string, { name: string | null; at: number }>()

/**
 * Current company names for the symbols a resolution moved a security to. A failed lookup only
 * leaves that name out: the caller keeps Plaid's, which is no worse than before.
 */
async function companyNames(alpaca: AlpacaClient, symbols: string[]): Promise<Map<string, string>> {
  const now = Date.now()
  const names = new Map<string, string>()
  for (const symbol of new Set(symbols)) {
    let hit = namesCache.get(symbol)
    if (!hit || now - hit.at > CHANGES_TTL_MS) {
      try {
        hit = { name: await alpaca.getAssetName(symbol), at: now }
        namesCache.set(symbol, hit)
      } catch (err) {
        console.warn(`[tickerResolution] no name for ${symbol}: ${err instanceof Error ? err.message : String(err)}`)
        continue
      }
    }
    if (hit.name) names.set(symbol, hit.name)
  }
  return names
}

async function tickerChanges(alpaca: AlpacaClient, symbols: string[], today: string): Promise<TickerChange[]> {
  const now = Date.now()
  const all = new Map<string, TickerChange>()
  const queried = new Set<string>()
  let pending = [...new Set(symbols)]

  // A rename's target can itself have been renamed later; each round asks only about symbols
  // the previous one discovered.
  for (let round = 0; round < MAX_CHAIN && pending.length > 0; round++) {
    const missing = pending.filter((s) => {
      const hit = changesCache.get(s)
      return !hit || now - hit.at > CHANGES_TTL_MS
    })
    if (missing.length > 0) {
      const fetched = await alpaca.getTickerChanges(missing, TICKER_CHANGES_SINCE, today)
      for (const s of missing) {
        changesCache.set(s, { changes: fetched.filter((c) => c.fromSymbol === s || c.toSymbol === s), at: now })
      }
    }
    for (const s of pending) queried.add(s)

    const found = pending.flatMap((s) => changesCache.get(s)?.changes ?? [])
    for (const c of found) all.set(`${c.fromSymbol}>${c.toSymbol}@${c.date}`, c)
    pending = [...new Set(found.map((c) => c.toSymbol))].filter((s) => !queried.has(s) && ALPACA_SYMBOL.test(s))
  }

  return [...all.values()]
}

function isPriceable(holding: Holding): holding is Holding & { ticker: string } {
  return (
    holding.optionContract == null &&
    holding.type != null &&
    PRICEABLE_TYPES.has(holding.type) &&
    holding.ticker != null &&
    ALPACA_SYMBOL.test(holding.ticker)
  )
}

/**
 * Holdings with each stock's ticker corrected to the symbol it trades under today, and a flag for
 * whether the market price may replace the institution's. Plaid's own ticker is kept as
 * `plaidTicker`.
 *
 * Never fails the holdings it was given: if Alpaca is down or rate-limited, they come back as Plaid
 * sent them, which is how the app behaved before any of this existed.
 */
export async function resolveHoldingTickers(
  holdings: Holding[],
  alpaca: AlpacaClient,
  today: string = new Date().toISOString().slice(0, 10),
): Promise<Holding[]> {
  const priceable = holdings.filter(isPriceable)
  if (priceable.length === 0) return holdings

  try {
    const changes = await tickerChanges(
      alpaca,
      priceable.map((h) => h.ticker),
      today,
    )
    const symbols = new Set(priceable.map((h) => h.ticker))
    for (const h of priceable) {
      for (const c of followChain(h.ticker, changes)) symbols.add(c.toSymbol)
    }
    const quotes = await alpaca.getLatestPrices([...symbols].filter((s) => ALPACA_SYMBOL.test(s)).slice(0, 100))

    const decisions = holdings.map((holding) =>
      isPriceable(holding)
        ? decideTicker(
            { ticker: holding.ticker, cusip: holding.cusip ?? null, institutionPrice: holding.institutionPrice },
            changes,
            quotes,
            today,
          )
        : null,
    )
    // Plaid keeps the SPAC's name along with its ticker, so a moved ticker gets today's name too.
    const names = await companyNames(
      alpaca,
      decisions.flatMap((d, i) => (d && d.ticker !== holdings[i].ticker ? [d.ticker] : [])),
    )

    return holdings.map((holding, i) => {
      const decision = decisions[i]
      if (!decision || (decision.ticker === holding.ticker && decision.marketPriceTrusted)) return holding
      const resolved: Holding = {
        ...holding,
        ticker: decision.ticker,
        plaidTicker: holding.ticker,
        marketPriceTrusted: decision.marketPriceTrusted,
      }
      const name = names.get(decision.ticker)
      if (name && name !== holding.name) {
        resolved.name = name
        resolved.plaidName = holding.name
      }
      return resolved
    })
  } catch (err) {
    console.warn(`[tickerResolution] left Plaid's tickers as-is: ${err instanceof Error ? err.message : String(err)}`)
    return holdings
  }
}

function isPriceableSecurity(security: ActivitySecurity): security is ActivitySecurity & { ticker: string } {
  return (
    !security.isOption &&
    security.type != null &&
    PRICEABLE_TYPES.has(security.type) &&
    security.ticker != null &&
    ALPACA_SYMBOL.test(security.ticker)
  )
}

function isoDaysBefore(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() - days)
  return d.toISOString().slice(0, 10)
}

/** The close on `date`, or the nearest one before it within TRADE_CLOSE_WINDOW_DAYS. */
export function closeOn(closes: DailyClose[] | undefined, date: string): number | null {
  const floor = isoDaysBefore(date, TRADE_CLOSE_WINDOW_DAYS)
  let best: DailyClose | null = null
  for (const c of closes ?? []) {
    if (c.date > date || c.date < floor || !(c.close > 0)) continue
    if (!best || c.date > best.date) best = c
  }
  return best?.close ?? null
}

/**
 * The securities an account's activity names, with tickers corrected as `resolveHoldingTickers`
 * does — these are what price the stocks sold since, when the account's past value is rebuilt.
 *
 * A sold stock has no institution price today, so its newest trade stands in: the trade's own
 * price, against each candidate symbol's close on that day. Only securities whose ticker Alpaca
 * shows moving are checked, which keeps this to a corporate-actions call (usually cached) and, when
 * something moved, one bars call. Holdings override these by security id on the client, so a stock
 * still held is settled by its holding either way.
 *
 * Never fails: on any Alpaca error the securities come back as Plaid sent them.
 */
export async function resolveActivitySecurities(
  securities: ActivitySecurity[],
  activity: InvestmentActivity[],
  alpaca: AlpacaClient,
  today: string = new Date().toISOString().slice(0, 10),
): Promise<ActivitySecurity[]> {
  const priceable = securities.filter(isPriceableSecurity)
  if (priceable.length === 0) return securities

  try {
    const changes = await tickerChanges(
      alpaca,
      priceable.map((s) => s.ticker),
      today,
    )
    const moved = priceable.filter((s) => followChain(s.ticker, changes).length > 0)
    if (moved.length === 0) return securities

    // Each moved security's newest trade with a price: the reference its candidates must match.
    const reference = new Map<string, { date: string; price: number }>()
    for (const row of activity) {
      if (!row.securityId || !(row.price > 0) || row.quantity === 0) continue
      const seen = reference.get(row.securityId)
      if (!seen || row.date > seen.date) reference.set(row.securityId, { date: row.date, price: row.price })
    }

    const candidates = new Set<string>()
    for (const s of moved) {
      candidates.add(s.ticker)
      for (const c of followChain(s.ticker, changes)) candidates.add(c.toSymbol)
    }
    const dates = moved.flatMap((s) => {
      const ref = reference.get(s.securityId)
      return ref ? [ref.date] : []
    })
    const closes =
      dates.length > 0
        ? await alpaca.getDailyCloses(
            [...candidates].filter((s) => ALPACA_SYMBOL.test(s)).slice(0, 100),
            isoDaysBefore(dates.reduce((a, b) => (a < b ? a : b)), TRADE_CLOSE_WINDOW_DAYS),
            dates.reduce((a, b) => (a > b ? a : b)),
          )
        : {}

    const movedIds = new Set(moved.map((s) => s.securityId))
    return securities.map((security) => {
      if (!isPriceableSecurity(security) || !movedIds.has(security.securityId)) return security
      const ref = reference.get(security.securityId)
      const decision = decideTickerAgainst(
        { ticker: security.ticker, cusip: security.cusip ?? null, referencePrice: ref?.price ?? null },
        changes,
        (symbol) => (ref ? closeOn(closes[symbol], ref.date) : null),
      )
      if (decision.ticker === security.ticker && decision.marketPriceTrusted) return security
      return { ...security, ticker: decision.ticker, plaidTicker: security.ticker, marketPriceTrusted: decision.marketPriceTrusted }
    })
  } catch (err) {
    console.warn(`[tickerResolution] left activity tickers as-is: ${err instanceof Error ? err.message : String(err)}`)
    return securities
  }
}
