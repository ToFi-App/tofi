import { useMemo } from 'react'
import { api } from '@/lib/api/client'
import { isInvestmentAccount } from '@/lib/accounts/netWorth'
import { priceableSymbol } from '@/lib/investments/accountHistory'
import { applyLivePrices, liveBalance } from '@/lib/investments/livePricing'
import { priceRetryDelayMs, shouldRetryPriceFetch } from '@/lib/investments/priceCache'
import type { Account, Holding } from '@/types/domain'

/** Holdings move only when the brokerage reports a trade; Plaid refreshes them about once a day. */
const HOLDINGS_STALE_MS = 5 * 60 * 1000
/** How long a set of quotes is reused before asking Alpaca again. The quota is shared by every user. */
const QUOTES_STALE_MS = 60 * 1000

/**
 * Investment accounts at the market's latest prices, for every screen figure that reads their
 * balance — the accounts list, net worth and the account sheet — so the three never disagree.
 *
 * Plaid supplies what only the brokerage knows (share counts, cost basis, cash); Alpaca supplies the
 * price, one snapshots call for every ticker on the screen. A holding keeps Plaid's price wherever
 * Plaid's is newer, and each balance moves by exactly what repricing moved its holdings.
 *
 * Fetching holdings here means one Plaid call per investment account when the screen opens, where
 * before they were fetched only when a sheet opened. The sheet's own holdings query has the same key,
 * so opening one costs nothing more.
 */
export function useLiveInvestments(accounts: Account[] | undefined): {
  accounts: Account[] | undefined
  /** Repriced holdings per investment account id, once its holdings have loaded. */
  holdingsByAccount: Map<string, Holding[]>
  /** Accounts whose holdings call failed, so nothing waits on them (see priceReadiness). */
  failedHoldings: Set<string>
} {
  const investmentAccounts = useMemo(() => (accounts ?? []).filter(isInvestmentAccount), [accounts])

  const holdingQueries = api.useQueries((t) =>
    investmentAccounts.map((a) =>
      t.investments.holdings({ itemId: a.itemId, accountId: a.account_id }, { staleTime: HOLDINGS_STALE_MS }),
    ),
  )
  // useQueries hands back a new array every render, so the memos below key on when each query's
  // data last changed rather than on the array.
  const plaidHoldings = holdingQueries.map((q) => q.data)
  const holdingsVersion = holdingQueries.map((q) => `${q.dataUpdatedAt}:${q.isError}`).join(',')

  const symbols = useMemo(() => {
    const unique = new Set<string>()
    for (const list of plaidHoldings) {
      for (const h of list ?? []) {
        const symbol = priceableSymbol({ ticker: h.ticker, type: h.type, isOption: h.optionContract != null })
        if (symbol) unique.add(symbol)
      }
    }
    return [...unique].sort()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [holdingsVersion])

  const quotes = api.investments.latestPrices.useQuery(
    { symbols },
    {
      enabled: symbols.length > 0,
      staleTime: QUOTES_STALE_MS,
      retry: shouldRetryPriceFetch,
      retryDelay: priceRetryDelayMs,
    },
  )

  return useMemo(() => {
    const holdingsByAccount = new Map<string, Holding[]>()
    const balanceById = new Map<string, number>()
    investmentAccounts.forEach((account, i) => {
      const plaid = plaidHoldings[i]
      if (!plaid) return
      // Without quotes (loading, or Alpaca unavailable) holdings and balance stay as Plaid has them.
      const live = quotes.data ? applyLivePrices(plaid, quotes.data) : plaid
      holdingsByAccount.set(account.account_id, live)
      if (account.balances?.current != null) {
        balanceById.set(account.account_id, liveBalance(account.balances.current, plaid, live))
      }
    })

    const repriced = accounts?.map((account) => {
      const balance = balanceById.get(account.account_id)
      if (balance == null || balance === account.balances?.current) return account
      return { ...account, balances: { ...account.balances, current: balance } }
    })
    const failedHoldings = new Set(
      investmentAccounts.filter((_, i) => holdingQueries[i]?.isError).map((a) => a.account_id),
    )
    return { accounts: repriced, holdingsByAccount, failedHoldings }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accounts, investmentAccounts, holdingsVersion, quotes.data])
}
