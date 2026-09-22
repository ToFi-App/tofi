import type { InvestmentsTransactionsGetRequest, PlaidApi } from 'plaid'

// Holdings for one investment account, with the security catalog already joined in —
// Plaid returns holdings and securities as two parallel arrays keyed by security_id, and
// no client should have to re-do that join.
export interface Holding {
  securityId: string
  /** Security display name ("Vanguard Total Stock Market ETF"), null for unknowns. */
  name: string | null
  /** Ticker symbol ("VTI"); null for e.g. cash-equivalent sweep positions. */
  ticker: string | null
  /** Plaid security type: 'equity' | 'etf' | 'mutual fund' | 'cash' | 'fixed income' | 'cryptocurrency' | ... */
  type: string | null
  quantity: number
  /** Market value as the institution reports it. */
  institutionValue: number | null
  /** Total cost basis for the position (not per share). */
  costBasis: number | null
  /** Latest per-share price as the institution reports it. */
  institutionPrice: number | null
  /** Previous trading session's close, for day-change math. May lag by institution. */
  closePrice: number | null
  /**
   * When the institution priced this holding — the instant `institutionValue` actually
   * describes, which is NOT when we fetched it. Brokerages commonly reprice once a day after
   * close, so a holding fetched seconds ago can carry a price from two days back.
   *
   * ISO 8601. Precision varies by institution and is deliberately preserved rather than
   * normalized: `institution_price_datetime` gives a full timestamp, `institution_price_as_of`
   * only a date, and rounding the second into the first would invent a time of day the
   * institution never reported. Null when the institution never dates its prices.
   */
  priceAsOf: string | null
  /** Parsed option details when the security is a contract — display "NFLX 355C", never the raw OCC symbol. */
  optionContract: { underlyingTicker: string | null; contractType: string; strikePrice: number } | null
  isoCurrencyCode: string | null
}

/**
 * One movement of cash across an investment account's boundary — money the user put in or took
 * out. Deliberately NOT the account's full activity: trades, fees and dividends are filtered out
 * at the source (see CASH_TRANSFER_SUBTYPES) and never reach the client.
 *
 * Carries no security fields for that reason. A contribution has no security, so the
 * holdings/securities join Holding above needs has nothing to join here.
 */
export interface InvestmentTransaction {
  investmentTransactionId: string
  accountId: string
  date: string
  /** Institution's own description, e.g. "ACH Deposit". */
  name: string
  /**
   * Plaid convention: positive when cash is DEBITED (a withdrawal), negative when credited (a
   * contribution arriving). Identical to the feed's positive-is-money-out convention, so nothing
   * downstream flips the sign.
   */
  amount: number
  /** 'contribution' | 'deposit' | 'withdrawal' | 'distribution' | 'transfer' */
  subtype: string
}

/**
 * The only investment subtypes this app ingests: cash crossing the boundary between the user and
 * the brokerage. These are the rows that have a counterpart in a linked checking account, which is
 * the entire reason the investments product is read at all — /transactions/sync returns nothing
 * for investment accounts, so without these a checking->brokerage transfer has no second leg and
 * gets counted as spending.
 *
 * Everything else is deliberately excluded, at the source rather than downstream:
 *  - buys and sells carry the full traded amount with a sign that reads exactly like spending and
 *    income, so a single rebalance would distort a month more than the bug this feature fixes;
 *  - fees and share transfers are portfolio activity, not household money;
 *  - dividends and interest are real income, but they have no counterpart to pair with, and
 *    letting them into the matcher meant they could be silently paired away as a transfer leg.
 *
 * Filtering here rather than in the client is what makes all of that structural: trades never
 * cross the wire, never enter the cache, and cannot be reintroduced by a downstream mistake.
 *
 * A WHITELIST, deliberately. Plaid adds subtypes over time and an unrecognized one is dropped,
 * which at worst leaves a genuine transfer unpaired (money stays counted — the safe direction).
 */
const CASH_TRANSFER_SUBTYPES = new Set(['contribution', 'deposit', 'withdrawal', 'distribution', 'transfer'])

/**
 * The subtype whitelist alone is not enough: Plaid types corporate actions — a distribution, a
 * spinoff, sale proceeds settling — as `type: 'cash'` with subtype `deposit`, and those slip
 * straight through it. They read as transfers but are money appearing INSIDE the brokerage, with
 * no counterpart in any linked account to pair against ("CROWDSTRIKE HLDGS INC CL A - DIST").
 *
 * `security_id` is what separates them. A genuine external transfer moves cash and names no
 * security; anything Plaid could attach a security to happened inside the account.
 *
 * The bias is deliberate. Dropping a real transfer leaves its checking-side leg counted as
 * spending — the mild, self-correcting direction this codebase prefers. Admitting a corporate
 * action invents income, or lets the matcher pair it away against unrelated real money.
 *
 * `type` is NOT part of the test, deliberately. Institutions disagree on vocabulary for the same
 * event: Fidelity reports external funding as `cash`/`transfer`, Robinhood as `transfer`/
 * `transfer`. Requiring `cash` silently dropped every Robinhood contribution and withdrawal —
 * their whole visible history — while keeping Fidelity's identical rows.
 *
 * `quantity` is what covers the case the `type` check was really there for: a SHARE transfer,
 * which is portfolio activity rather than household money. Moving units means non-zero quantity
 * (negative when leaving), moving only cash means zero. It is the better test on two counts —
 * it is non-nullable, so it holds even when an institution omits the security_id that a share
 * transfer ought to carry, and it describes what actually distinguishes the two events rather
 * than which word one institution happened to use.
 */
const CASH_TRANSFER_TYPES = new Set(['cash', 'transfer'])

function isCashTransfer(txn: {
  type: string
  subtype: string
  security_id?: string | null
  quantity?: number
}): boolean {
  if (txn.security_id) return false
  if (txn.quantity) return false
  if (!CASH_TRANSFER_TYPES.has(txn.type.toLowerCase())) return false
  return CASH_TRANSFER_SUBTYPES.has(txn.subtype.toLowerCase())
}

/**
 * Bounds one item's paging the way MAX_PAGES_PER_ITEM bounds transactionSyncService. Unlike
 * /transactions/sync there is no cursor to resume from, so an undrained item simply returns
 * what it got — the client's 24-month backfill window is re-requested on the next sync and the
 * merge is idempotent by investmentTransactionId.
 */
export const MAX_INVESTMENT_PAGES = 10

const INVESTMENT_PAGE_SIZE = 500

export const investmentRepository = {
  async getHoldings(client: PlaidApi, accessToken: string, accountId: string): Promise<Holding[]> {
    const response = await client.investmentsHoldingsGet({
      access_token: accessToken,
      options: { account_ids: [accountId] },
    } as never)

    const securityById = new Map(response.data.securities.map((s) => [s.security_id, s]))
    return response.data.holdings.map((holding) => {
      const security = securityById.get(holding.security_id)
      return {
        securityId: holding.security_id,
        name: security?.name ?? null,
        ticker: security?.ticker_symbol ?? null,
        type: security?.type ?? null,
        quantity: holding.quantity,
        institutionValue: holding.institution_value ?? null,
        costBasis: holding.cost_basis ?? null,
        institutionPrice: holding.institution_price ?? null,
        closePrice: security?.close_price ?? null,
        // Datetime first: same fact at higher precision when the institution reports it.
        priceAsOf: holding.institution_price_datetime ?? holding.institution_price_as_of ?? null,
        optionContract: security?.option_contract
          ? {
              underlyingTicker: security.option_contract.underlying_security_ticker ?? null,
              contractType: security.option_contract.contract_type,
              strikePrice: security.option_contract.strike_price,
            }
          : null,
        isoCurrencyCode: holding.iso_currency_code ?? null,
      }
    })
  },

  async getTransactions(
    client: PlaidApi,
    accessToken: string,
    startDate: string,
    endDate: string,
  ): Promise<InvestmentTransaction[]> {
    const collected: InvestmentTransaction[] = []
    // Paging offset counts rows Plaid RETURNED, not rows that survived the filter. Using the
    // filtered length would re-request everything a page dropped, and on an account that trades
    // heavily the drain would never advance past its first page.
    let fetchedCount = 0

    for (let page = 0; page < MAX_INVESTMENT_PAGES; page++) {
      const request: InvestmentsTransactionsGetRequest = {
        access_token: accessToken,
        start_date: startDate,
        end_date: endDate,
        options: { count: INVESTMENT_PAGE_SIZE, offset: fetchedCount },
      }
      const response = await client.investmentsTransactionsGet(request)

      const rows = response.data.investment_transactions
      fetchedCount += rows.length
      for (const txn of rows) {
        if (!isCashTransfer(txn)) continue
        collected.push({
          investmentTransactionId: txn.investment_transaction_id,
          accountId: txn.account_id,
          date: txn.date,
          name: txn.name,
          amount: txn.amount,
          subtype: txn.subtype,
        })
      }

      // An empty page ends the drain regardless of what total reports: some institutions
      // over-report total_investment_transactions, and trusting it would spin to MAX pages.
      if (rows.length === 0) break
      if (fetchedCount >= response.data.total_investment_transactions) break
    }

    return collected
  },
}
