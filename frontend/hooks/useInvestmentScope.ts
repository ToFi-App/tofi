import { useMemo } from 'react'
import { useInvestmentPortfolio } from '@/hooks/useInvestmentPortfolio'
import type { InvestmentHistoryState } from '@/hooks/useInvestmentHistory'
import { combineHistoryStates, mergeHoldings } from '@/lib/investments/portfolio'
import type { Holding } from '@/types/domain'

const TODAY_ISO = new Date().toISOString().slice(0, 10)
const EMPTY_HISTORY: InvestmentHistoryState = {
  history: null,
  inputs: null,
  earliest: TODAY_ISO,
  priceEarliest: TODAY_ISO,
  today: TODAY_ISO,
  isLoading: true,
  isRateLimited: false,
  tradesUnavailable: false,
}

/**
 * The investments in view: one account, or every one of them when `accountId` is null (or names an
 * account since unlinked). Their holdings — merged by security across accounts — and their history
 * folded into one. Shared by the Investments screen and the holding page it pushes, so the two
 * always agree on what's in view.
 */
export function useInvestmentScope(accountId: string | null) {
  const portfolio = useInvestmentPortfolio()
  const { investmentAccounts, holdingsByAccount, failedHoldings, histories } = portfolio

  const selectedAccount = accountId ? (investmentAccounts.find((a) => a.account_id === accountId) ?? null) : null
  const shownAccounts = useMemo(
    () => (selectedAccount ? [selectedAccount] : investmentAccounts),
    [selectedAccount, investmentAccounts],
  )

  const holdings = useMemo(() => {
    const lists = shownAccounts.map((a) => holdingsByAccount.get(a.account_id)).filter((l): l is Holding[] => l != null)
    return lists.length === 1 ? lists[0] : mergeHoldings(lists)
  }, [shownAccounts, holdingsByAccount])

  const investmentHistory = useMemo(() => {
    const states = shownAccounts.map((a) => histories.get(a.account_id)).filter((s): s is InvestmentHistoryState => s != null)
    return combineHistoryStates(states) ?? EMPTY_HISTORY
  }, [shownAccounts, histories])

  return {
    portfolio,
    selectedAccount,
    shownAccounts,
    holdings,
    holdingsLoading: shownAccounts.some((a) => !holdingsByAccount.has(a.account_id) && !failedHoldings.has(a.account_id)),
    holdingsFailed: shownAccounts.length > 0 && shownAccounts.every((a) => failedHoldings.has(a.account_id)),
    investmentHistory,
  }
}
