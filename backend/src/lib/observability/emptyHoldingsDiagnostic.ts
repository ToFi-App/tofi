import type { PlaidApi } from 'plaid'
import { sendToAxiom } from './axiom.js'

/**
 * TEMPORARY — remove once the empty-holdings report is explained.
 *
 * A self-directed Fidelity Roth IRA showed its balance (accounts/get) while
 * investments/holdings/get, filtered to that account, came back empty with no error. Nothing in the
 * app drops holdings, so this records what Plaid actually says about the Item when that happens:
 *
 *  - the same call WITHOUT the account filter, and which account_ids the holdings it returns are
 *    attached to — holdings filed under a different id than accounts/get reports would show here;
 *  - whether the account appears in the holdings response's own `accounts` list at all, and as
 *    what type/subtype;
 *  - the Item's products/consented products, and Plaid's request_id for a support ticket.
 *
 * Counts, types and opaque ids only: no balances, names, masks or positions. Never throws — it runs
 * on a request that is otherwise succeeding.
 */
export async function reportEmptyHoldings(input: {
  client: PlaidApi
  accessToken: string
  userId: string
  itemId: string
  accountId: string
}): Promise<void> {
  const { client, accessToken, userId, itemId, accountId } = input
  let detail: object
  try {
    const response = await client.investmentsHoldingsGet({ access_token: accessToken })
    const data = response.data
    const holdingsByAccount: Record<string, number> = {}
    for (const holding of data.holdings) {
      holdingsByAccount[holding.account_id] = (holdingsByAccount[holding.account_id] ?? 0) + 1
    }
    const item = data.item as unknown as Record<string, unknown>
    detail = {
      unfilteredRequestId: data.request_id,
      totalHoldings: data.holdings.length,
      totalSecurities: data.securities.length,
      holdingsByAccount,
      accounts: data.accounts.map((a) => ({
        accountId: a.account_id,
        type: a.type,
        subtype: a.subtype ?? null,
        holdings: holdingsByAccount[a.account_id] ?? 0,
      })),
      targetInAccounts: data.accounts.some((a) => a.account_id === accountId),
      // Holdings attached to an account_id the response's own account list doesn't name.
      orphanAccountIds: Object.keys(holdingsByAccount).filter((id) => !data.accounts.some((a) => a.account_id === id)),
      products: item.products ?? null,
      consentedProducts: item.consented_products ?? null,
      billedProducts: item.billed_products ?? null,
      isInvestmentsFallbackItem: (data as unknown as Record<string, unknown>).is_investments_fallback_item ?? null,
    }
  } catch (err) {
    const plaidError = (err as { response?: { data?: { error_code?: string; request_id?: string } } }).response?.data
    detail = {
      unfilteredError: plaidError?.error_code ?? (err instanceof Error ? err.message : String(err)),
      unfilteredRequestId: plaidError?.request_id ?? null,
    }
  }

  const event = {
    _time: new Date().toISOString(),
    level: 'warn',
    service: 'tofi-backend',
    env: process.env.VERCEL_ENV ?? process.env.NODE_ENV ?? 'development',
    msg: 'investments.holdings returned no holdings for the account',
    diagnostic: 'empty-holdings',
    userId,
    itemId,
    accountId,
    ...detail,
  }
  // stdout for live tail; Axiom for the copy that outlasts Vercel's hour of logs.
  console.warn(JSON.stringify(event))
  await sendToAxiom([event])
}
