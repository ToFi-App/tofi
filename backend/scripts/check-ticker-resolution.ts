/**
 * Manual check of ticker resolution against the real Alpaca API.
 *
 *   cd backend
 *   npx tsx scripts/check-ticker-resolution.ts                     # ACIC and DMYI
 *   npx tsx scripts/check-ticker-resolution.ts ACIC=8.05 DMYI=41.9  # with your brokerage's prices
 *
 * Each argument is a Plaid ticker, optionally with the per-share price your brokerage shows for the
 * position. Without one, the script uses today's price of the stock it expects (ACHR, IONQ) so
 * the price check has something to compare against. Reads ALPACA_KEY_ID / ALPACA_SECRET_KEY from
 * backend/.env. It only reads market data; nothing is written anywhere.
 */
import 'dotenv/config'
import { alpacaClientFromEnv } from '../src/lib/alpaca/client.js'
import type { Holding } from '../src/repositories/investmentRepository.js'
import { TICKER_CHANGES_SINCE, resolveHoldingTickers } from '../src/services/tickerResolutionService.js'

const EXPECTED: Record<string, string> = { ACIC: 'ACHR', DMYI: 'IONQ' }

async function main() {
  const args = process.argv.slice(2)
  const inputs = (args.length > 0 ? args : ['ACIC', 'DMYI']).map((arg) => {
    const [ticker, price] = arg.split('=')
    return { ticker: ticker.toUpperCase(), price: price ? Number(price) : null }
  })
  const alpaca = alpacaClientFromEnv()
  const today = new Date().toISOString().slice(0, 10)

  console.log('1. Raw corporate actions Alpaca returns for these symbols')
  console.log('   (confirms the history reaches back to 2021, and whether the symbols filter matches the OLD symbol)')
  const changes = await alpaca.getTickerChanges(
    inputs.map((i) => i.ticker),
    TICKER_CHANGES_SINCE,
    today,
  )
  if (changes.length === 0) console.log('   none')
  for (const c of changes) console.log(`   ${c.date}  ${c.fromSymbol} -> ${c.toSymbol}  (cusip ${c.fromCusip} -> ${c.toCusip})`)

  const lookups = [...new Set([...inputs.map((i) => i.ticker), ...inputs.map((i) => EXPECTED[i.ticker]).filter(Boolean)])]
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
  })
  process.exitCode = failures > 0 ? 1 : 0
}

main().catch((err) => {
  console.error(err)
  process.exitCode = 1
})
