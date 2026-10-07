import { useMemo, useState } from 'react'
import { api } from '@/lib/api/client'
import { getCachedPriceMonth, getCachedSplits, setCachedPriceMonth, setCachedSplits } from '@/lib/storage/mmkv'
import {
  assembleCloses,
  isRateLimited,
  isSettled,
  monthsBetween,
  planPriceFetch,
  priceRetryDelayMs,
  settledMonthsToWrite,
  shouldRetryPriceFetch,
} from '@/lib/investments/priceCache'
import { buildAccountHistory, historySymbols, type AccountHistory } from '@/lib/investments/accountHistory'
import { priceReadiness } from '@/lib/investments/readiness'
import type { ActivitySecurity, DailyClose, Holding, InvestmentActivity, Split } from '@/types/domain'

/**
 * How far back history is rebuilt: the ~24 months Plaid serves investment activity for. Before
 * that there are no trades to undo, so nothing older could be reconstructed honestly.
 */
export const HISTORY_DAYS = 730

/**
 * How far back prices are fetched: five years, for a holding's own chart. Unlike the account, a
 * stock's line needs no activity, so it reaches as far as the 5Y pill. A cold cache pays this once;
 * settled months never expire.
 */
export const PRICE_HISTORY_DAYS = 5 * 365 + 1

/** Activity changes only when the brokerage reports; Plaid refreshes it about once a day. */
const ACTIVITY_STALE_MS = 5 * 60 * 1000

function isoDaysAgo(today: Date, days: number): string {
  const d = new Date(today)
  d.setUTCDate(d.getUTCDate() - days)
  return d.toISOString().slice(0, 10)
}

export interface InvestmentHistoryState {
  /** Null until the activity has resolved, so the line never redraws once trades arrive. */
  history: AccountHistory | null
  /** What the history was built from — closes, splits, activity — for a holding's own page. */
  inputs: {
    closes: Record<string, DailyClose[]>
    splits: Split[]
    activity: InvestmentActivity[]
    securities: ActivitySecurity[]
  } | null
  /** The oldest date the account's history covers: what its All range reaches. */
  earliest: string
  /** The oldest date prices are fetched from: what a holding's All range reaches. */
  priceEarliest: string
  today: string
  isLoading: boolean
  isRateLimited: boolean
  /** The institution didn't serve activity, so the line is today's holdings priced back. */
  tradesUnavailable: boolean
}

export interface InvestmentAccountInput {
  itemId: string
  accountId: string
  /** The account's balance today — live-priced — which its history ends on. */
  anchorValue: number
  /** Today's holdings, live-priced; undefined while they load or when they failed. */
  holdings: Holding[] | undefined
  /** The holdings call failed: this account is left out rather than waited for. */
  holdingsFailed: boolean
}

/**
 * Every investment account's value over the past two years, rebuilt from its activity and priced
 * through a never-expiring month cache of Alpaca closes in MMKV. One hook for all of them, so the
 * accounts screen — net worth's investment bands and each account's sheet — reads one rebuild per
 * account and one price request for every ticker on the screen.
 *
 * Activity comes first: it names the securities sold out since, which need prices too, and waiting
 * for every account's keeps the price request to one. The app shares one Alpaca key (200 calls/min)
 * across every user, so the cache is what makes the budget hold: a cold cache costs one multi-symbol
 * request, a warm one a small request a day for the open month. A rate-limited request waits out the
 * quota's own reset and retries; meanwhile tickers without closes sit flat at today's price.
 */
export function useInvestmentHistories(accounts: InvestmentAccountInput[]): Map<string, InvestmentHistoryState> {
  // Bumped after MMKV writes land so the history memo re-reads the cache — the same side-effect
  // pattern as useInvestmentTransactions.
  const [writtenAt, setWrittenAt] = useState(0)

  // Captured once per mount, like useInvestmentTransactions' window: a screen left open past
  // midnight keeps yesterday's range, which the next open corrects.
  const { today, startDate, priceStart } = useMemo(() => {
    const now = new Date()
    return {
      today: now.toISOString().slice(0, 10),
      startDate: isoDaysAgo(now, HISTORY_DAYS),
      priceStart: isoDaysAgo(now, PRICE_HISTORY_DAYS),
    }
  }, [])

  const activityQueries = api.useQueries((t) =>
    accounts.map((a) =>
      t.investments.activity(
        { itemId: a.itemId, accountId: a.accountId, startDate, endDate: today },
        { staleTime: ACTIVITY_STALE_MS, retry: 1 },
      ),
    ),
  )
  // useQueries hands back a new array every render; the memos below key on when each query's data
  // last changed instead.
  const activityVersion = activityQueries.map((q) => `${q.dataUpdatedAt}:${q.isLoading}`).join(',')
  const holdingsVersion = accounts.map((a) => (a.holdings ? a.holdings.length : a.holdingsFailed ? 'x' : -1)).join(',')
  const { ready: allResolved, included } = priceReadiness(
    accounts,
    activityQueries.map((q) => q.isLoading),
  )

  const symbols = useMemo(() => {
    if (!allResolved) return []
    const unique = new Set<string>()
    accounts.forEach((a, i) => {
      if (!included[i]) return
      for (const s of historySymbols(a.holdings ?? [], activityQueries[i]?.data?.securities ?? [])) unique.add(s)
    })
    return [...unique].sort()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allResolved, activityVersion, holdingsVersion])

  // Not keyed on writtenAt: recomputing after the writes would narrow the plan to the open month,
  // a new query key, and fire a second request for data that just arrived.
  const plan = useMemo(
    () =>
      planPriceFetch({
        symbols,
        startDate: priceStart,
        today,
        isCached: (symbol, month) => getCachedPriceMonth(symbol, month) != null,
      }),
    [symbols, priceStart, today],
  )

  const prices = api.investments.priceHistory.useQuery(plan ?? { symbols: [], startDate: '', endDate: '' }, {
    enabled: plan != null,
    // Prices move once a day; reopening the screen must not spend the shared quota again.
    staleTime: 60 * 60 * 1000,
    retry: shouldRetryPriceFetch,
    retryDelay: priceRetryDelayMs,
    onSuccess: (result) => {
      if (!plan) return
      for (const write of settledMonthsToWrite({ closes: result.closes, startDate: plan.startDate, endDate: plan.endDate, today })) {
        setCachedPriceMonth(write.symbol, write.month, write.closes)
      }
      for (const symbol of plan.symbols) {
        setCachedSplits(symbol, result.splits.filter((s) => s.symbol === symbol))
      }
      setWrittenAt(Date.now())
    },
  })

  // Closes and splits for every symbol, read once and shared by every account's rebuild.
  const market = useMemo(() => {
    if (!allResolved) return null
    return {
      closes: assembleCloses({
        symbols,
        months: monthsBetween(priceStart, today),
        // Only settled months count as held; the open month always comes from the response.
        readMonth: (symbol, month) => (isSettled(month, today) ? getCachedPriceMonth(symbol, month) : null),
        fresh: prices.data?.closes,
      }),
      splits: prices.data?.splits ?? symbols.flatMap((s) => getCachedSplits(s)),
    }
    // writtenAt: MMKV writes happen outside React state.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allResolved, symbols, priceStart, today, prices.data, writtenAt])

  const rateLimited = isRateLimited(prices.error) || (prices.failureCount > 0 && isRateLimited(prices.failureReason))
  const pricesLoading = plan != null && prices.isFetching

  return useMemo(() => {
    const byAccount = new Map<string, InvestmentHistoryState>()
    accounts.forEach((account, i) => {
      const activity = activityQueries[i]
      const inputs =
        market && account.holdings
          ? {
              ...market,
              activity: activity?.data?.transactions ?? [],
              securities: activity?.data?.securities ?? [],
            }
          : null
      byAccount.set(account.accountId, {
        history:
          inputs && account.holdings
            ? buildAccountHistory({ holdings: account.holdings, anchorValue: account.anchorValue, startDate, today, ...inputs })
            : null,
        inputs,
        earliest: startDate,
        priceEarliest: priceStart,
        today,
        // A failed account has nothing coming; its sheet shows the holdings error instead.
        isLoading: account.holdingsFailed ? false : (activity?.isLoading ?? true) || pricesLoading,
        isRateLimited: rateLimited,
        tradesUnavailable: activity?.isError ?? false,
      })
    })
    return byAccount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accounts, activityVersion, market, startDate, priceStart, today, pricesLoading, rateLimited])
}
