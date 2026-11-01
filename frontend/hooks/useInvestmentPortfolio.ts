import { useMemo } from 'react'
import { useAccounts } from '@/hooks/useAccounts'
import { useLiveInvestments } from '@/hooks/useLiveInvestments'
import { useInvestmentHistories, type InvestmentHistoryState } from '@/hooks/useInvestmentHistory'
import { isInvestmentAccount } from '@/lib/accounts/netWorth'
import type { Account, Holding } from '@/types/domain'

/**
 * Investment accounts at live prices, with each one's rebuilt history — what Net Worth and
 * Investments both read. One hook so the two tabs share the same query keys (and so the same
 * network calls and the same figures) rather than each assembling its own.
 */
export function useInvestmentPortfolio(): {
  accounts: ReturnType<typeof useAccounts>
  /** Every account, investment balances at the market's latest prices. */
  liveAccounts: Account[] | undefined
  investmentAccounts: Account[]
  holdingsByAccount: Map<string, Holding[]>
  failedHoldings: Set<string>
  histories: Map<string, InvestmentHistoryState>
} {
  const accounts = useAccounts()
  const live = useLiveInvestments(accounts.data)
  const investmentAccounts = useMemo(() => (live.accounts ?? []).filter(isInvestmentAccount), [live.accounts])
  const historyInputs = useMemo(
    () =>
      investmentAccounts.map((a) => ({
        itemId: a.itemId,
        accountId: a.account_id,
        anchorValue: a.balances?.current ?? 0,
        holdings: live.holdingsByAccount.get(a.account_id),
        holdingsFailed: live.failedHoldings.has(a.account_id),
      })),
    [investmentAccounts, live.holdingsByAccount, live.failedHoldings],
  )
  const histories = useInvestmentHistories(historyInputs)
  return {
    accounts,
    liveAccounts: live.accounts,
    investmentAccounts,
    holdingsByAccount: live.holdingsByAccount,
    failedHoldings: live.failedHoldings,
    histories,
  }
}
