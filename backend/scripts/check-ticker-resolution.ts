/**
 * Manual check of ticker resolution against the real Alpaca API.
 *
 *   cd backend
 *   npx tsx scripts/check-ticker-resolution.ts                     # ACIC and DMYI
 *   npx tsx scripts/check-ticker-resolution.ts ACIC=8.05 DMYI=41.9  # with your brokerage's prices
 *   npx tsx scripts/check-ticker-resolution.ts ACIC@2025-05-02=9.05 # a SOLD position: last trade
 *
 * Each argument is a Plaid ticker, optionally with the per-share price your brokerage shows for the
 * position. `TICKER@DATE=PRICE` instead checks it as a stock you sold, using that trade's date and
 * price, the way the account's history resolves sold positions. A held ticker given no price is
 * checked against today's price of the stock it is expected to become (ACHR, IONQ), so the price
 * check has something to compare against — pass your brokerage's real price for an honest test. Reads ALPACA_KEY_ID / ALPACA_SECRET_KEY from
 * backend/.env. It only reads market data; nothing is written anywhere.
 */
import 'dotenv/config'
import { alpacaClientFromEnv } from '../src/lib/alpaca/client.js'
import type { ActivitySecurity, Holding, InvestmentActivity } from '../src/repositories/investmentRepository.js'
import {
  TICKER_CHANGES_SINCE,
  resolveActivitySecurities,
  resolveHoldingTickers,
} from '../src/services/tickerResolutionService.js'

const EXPECTED: Record<string, string> = { ACIC: 'ACHR', DMYI: 'IONQ' }

async function main() {
  const args = process.argv.slice(2)
  const parsed = (args.length > 0 ? args : ['ACIC', 'DMYI']).map((arg) => {
    const [left, price] = arg.split('=')
    const [ticker, soldOn] = left.split('@')
    return { ticker: ticker.toUpperCase(), price: price ? Number(price) : null, soldOn: soldOn ?? null }
  })
  const inputs = parsed.filter((i) => !i.soldOn)
  const sold = parsed.filter((i) => i.soldOn)
  const alpaca = alpacaClientFromEnv()
  const today = new Date().toISOString().slice(0, 10)

  console.log('1. Raw corporate actions Alpaca returns for these symbols')
  console.log('   (confirms the history reaches back to 2021, and whether the symbols filter matches the OLD symbol)')
  const changes = await alpaca.getTickerChanges(
    parsed.map((i) => i.ticker),
    TICKER_CHANGES_SINCE,
    today,
  )
  if (changes.length === 0) console.log('   none')
  for (const c of changes) console.log(`   ${c.date}  ${c.fromSymbol} -> ${c.toSymbol}  (cusip ${c.fromCusip} -> ${c.toCusip})`)

  const lookups = [...new Set([...parsed.map((i) => i.ticker), ...parsed.map((i) => EXPECTED[i.ticker]).filter(Boolean)])]
  const quotes = await alpaca.getLatestPrices(lookups)
  console.log('\n2. Latest trades on the IEX feed')
  for (const s of lookups) console.log(`   ${s.padEnd(6)} ${quotes[s] ? `$${quotes[s].price} at ${quotes[s].at}` : 'no quote'}`)

  const holdings: Holding[] = inputs.map((input, i) => ({
    securityId: `manual-${i}`,
    name: null,
    ticker: input.ticker,
    cusip: null,
    type: 'equity',
    quantity: 1,
    institutionValue: null,
    costBasis: null,
    institutionPrice: input.price ?? quotes[EXPECTED[input.ticker]]?.price ?? null,
    closePrice: null,
    priceAsOf: null,
    optionContract: null,
    isoCurrencyCode: 'USD',
  }))

  console.log('\n3. What the holdings endpoint would now return')
  const resolved = await resolveHoldingTickers(holdings, alpaca, today)
  let failures = 0
  resolved.forEach((h, i) => {
    const plaid = inputs[i].ticker
    const expected = EXPECTED[plaid]
    const ok = expected ? h.ticker === expected && h.marketPriceTrusted !== false : true
    if (!ok) failures++
    console.log(
      `   ${plaid.padEnd(6)} -> ${String(h.ticker).padEnd(6)} live price ${h.marketPriceTrusted === false ? 'NOT trusted' : 'trusted'}` +
        `  (institution price used: ${holdings[i].institutionPrice ?? 'none'})` +
        (expected ? `  ${ok ? 'OK' : `EXPECTED ${expected}`}` : ''),
    )
    console.log(`          name: ${h.name ?? '(none)'}`)
  })

  if (sold.length > 0) {
    console.log('\n4. Sold positions, as the account history would price them')
    const securities: ActivitySecurity[] = sold.map((s, i) => ({
      securityId: `sold-${i}`,
      ticker: s.ticker,
      cusip: null,
      type: 'equity',
      isOption: false,
    }))
    const trades: InvestmentActivity[] = sold.map((s, i) => ({
      investmentTransactionId: `sold-${i}`,
      date: s.soldOn!,
      securityId: `sold-${i}`,
      type: 'sell',
      subtype: 'sell',
      quantity: -1,
      amount: -(s.price ?? 0),
      price: s.price ?? 0,
      isCashTransfer: false,
    }))
    const resolvedSold = await resolveActivitySecurities(securities, trades, alpaca, today)
    resolvedSold.forEach((r, i) => {
      const expected = EXPECTED[sold[i].ticker]
      const ok = expected ? r.ticker === expected && r.marketPriceTrusted !== false : true
      if (!ok) failures++
      console.log(
        `   ${sold[i].ticker.padEnd(6)} -> ${String(r.ticker).padEnd(6)} closes ${r.marketPriceTrusted === false ? 'NOT trusted' : 'trusted'}` +
          `  (trade ${sold[i].soldOn} at ${sold[i].price ?? 'no price'})` +
          (expected ? `  ${ok ? 'OK' : `EXPECTED ${expected}`}` : ''),
      )
    })
  }
  process.exitCode = failures > 0 ? 1 : 0
}

main().catch((err) => {
  console.error(err)
  process.exitCode = 1
})
