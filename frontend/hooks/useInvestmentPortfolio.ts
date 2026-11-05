import { useMemo } from 'react'
import { useAccounts } from '@/hooks/useAccounts'
import { useLiveInvestments } from '@/hooks/useLiveInvestments'
import { useInvestmentHistories, type InvestmentHistoryState } from '@/hooks/useInvestmentHistory'
import { isInvestmentAccount } from '@/lib/accounts/netWorth'
import { reconcileAccount } from '@/lib/investments/reconcileHoldings'
import type { Account, Holding } from '@/types/domain'

/**
 * Investment accounts at live prices, with each one's rebuilt history — what Net Worth and
 * Investments both read. One hook so the two tabs share the same query keys (and so the same
 * network calls and the same figures) rather than each assembling its own.
 */
export function useInvestmentPortfolio(): {
  accounts: ReturnType<typeof useAccounts>
  /** Every account, investment balances at the market's latest prices and corrected for trades the brokerage hasn't caught up with. */
  liveAccounts: Account[] | undefined
  investmentAccounts: Account[]
  /** Each account's holdings at live prices, with trades the brokerage hasn't caught up with applied. */
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

  // What's held now, not as of the brokerage's last upload: holdings are checked against the trades the
  // histories already fetched, and recent ones the brokerage hasn't caught up with are applied
  // (reconcileAccount), so a position sold yesterday is gone today. Its balance comes from the same
  // snapshot, so it moves by the same trades — the positions' change in value plus the cash they moved —
  // which keeps it equal to the end of the rebuilt history, where buildAccountHistory makes the same
  // correction.
  const { holdingsByAccount, balanceDelta } = useMemo(() => {
    const reconciledHoldings = new Map<string, Holding[]>()
    const deltas = new Map<string, number>()
    const value = (list: Holding[]) => list.reduce((sum, h) => (h.type === 'cash' ? sum : sum + (h.institutionValue ?? 0)), 0)
    for (const [accountId, holdings] of live.holdingsByAccount) {
      const history = histories.get(accountId)
      if (!history?.inputs) {
        reconciledHoldings.set(accountId, holdings)
        continue
      }
      const reconciled = reconcileAccount(holdings, history.inputs.activity, history.today)
      reconciledHoldings.set(accountId, reconciled.holdings)
      if (reconciled.holdings !== holdings) deltas.set(accountId, value(reconciled.holdings) - value(holdings) + reconciled.cashDelta)
    }
    return { holdingsByAccount: reconciledHoldings, balanceDelta: deltas }
  }, [live.holdingsByAccount, histories])

  const correctedAccounts = useMemo(() => {
    if (balanceDelta.size === 0) return live.accounts
    return live.accounts?.map((account) => {
      const delta = balanceDelta.get(account.account_id)
      if (delta == null || account.balances?.current == null) return account
      return { ...account, balances: { ...account.balances, current: Math.round((account.balances.current + delta) * 100) / 100 } }
    })
  }, [live.accounts, balanceDelta])
  const correctedInvestmentAccounts = useMemo(
    () => (balanceDelta.size === 0 ? investmentAccounts : (correctedAccounts ?? []).filter(isInvestmentAccount)),
    [balanceDelta, investmentAccounts, correctedAccounts],
  )

  return {
    accounts,
    liveAccounts: correctedAccounts,
    investmentAccounts: correctedInvestmentAccounts,
    holdingsByAccount,
    failedHoldings: live.failedHoldings,
    histories,
  }
}
