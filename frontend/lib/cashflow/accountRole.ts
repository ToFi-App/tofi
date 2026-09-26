import { isInvestmentAccount, isLiabilityAccount } from '@/lib/accounts/accountType'

/**
 * What an account is FOR in the cash-flow picture, which is what names the money moving into it:
 * a transfer into a savings account is "saved", into a brokerage "invested", onto a card or loan
 * "debt paid down". Everything else is where day-to-day money lives and gets spent from.
 */
export type AccountRole = 'spending' | 'savings' | 'invested' | 'debt'

/**
 * Plaid depository subtypes that hold money set aside rather than spent. HSA is here rather than
 * under invested: Plaid only reports it as depository when it is the cash side, and a contribution
 * to it reads to the user as saving.
 */
const SAVINGS_SUBTYPES = new Set(['savings', 'cd', 'money market', 'hsa'])

export function accountRole(account: { type: string; subtype?: string | null }): AccountRole {
  if (isLiabilityAccount(account)) return 'debt'
  // Brokerage and retirement accounts only. A brokerage's cash-management account is deliberately
  // NOT here: people use those as their checking account — paycheck in, bills out — and calling
  // that "invested" would make an ordinary rent payment read as a withdrawal from investments.
  if (isInvestmentAccount(account)) return 'invested'
  if (account.subtype && SAVINGS_SUBTYPES.has(account.subtype)) return 'savings'
  return 'spending'
}
