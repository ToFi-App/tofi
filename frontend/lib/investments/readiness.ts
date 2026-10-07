/**
 * Whether the accounts screen can plan its one price request yet, and which accounts it covers.
 *
 * It waits for every account still loading — holdings or activity — so the tickers sold out since
 * are known and prices are asked for once rather than once per account as each arrives. An account
 * whose holdings FAILED is not waited for: it has nothing to price, and waiting on it left every
 * other account's chart, and net worth's investment bands, without prices for as long as it kept
 * failing. It is left out of the request and of the rebuild; its sheet shows the holdings error.
 */
export function priceReadiness(
  accounts: Array<{ holdings: unknown[] | undefined; holdingsFailed: boolean }>,
  activityLoading: boolean[],
): { ready: boolean; included: boolean[] } {
  const included = accounts.map((a) => a.holdings != null)
  const ready =
    accounts.length > 0 &&
    accounts.every((a, i) => (a.holdings != null && !activityLoading[i]) || a.holdingsFailed)
  return { ready, included }
}
