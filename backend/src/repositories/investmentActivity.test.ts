import { describe, expect, it, vi } from 'vitest'
import { investmentRepository } from './investmentRepository.js'
import type { PlaidApi } from 'plaid'

function plaidReturning(pages: Array<{ investment_transactions: unknown[]; securities?: unknown[]; total: number }>) {
  const investmentsTransactionsGet = vi.fn()
  for (const page of pages) {
    investmentsTransactionsGet.mockResolvedValueOnce({
      data: {
        investment_transactions: page.investment_transactions,
        securities: page.securities ?? [],
        total_investment_transactions: page.total,
      },
    })
  }
  return { client: { investmentsTransactionsGet } as unknown as PlaidApi, investmentsTransactionsGet }
}

const buy = {
  investment_transaction_id: 'it-buy',
  account_id: 'acc-1',
  date: '2025-03-03',
  name: 'BUY VTI',
  amount: 2500,
  quantity: 10,
  price: 250,
  security_id: 'sec-vti',
  type: 'buy',
  subtype: 'buy',
}
const deposit = {
  investment_transaction_id: 'it-dep',
  account_id: 'acc-1',
  date: '2025-03-01',
  name: 'ACH Deposit',
  amount: -3000,
  quantity: 0,
  price: 0,
  security_id: null,
  type: 'cash',
  subtype: 'deposit',
}

describe('investmentRepository.getAccountActivity', () => {
  it('keeps every row for the one account — trades included — and the securities they name', async () => {
    const { client, investmentsTransactionsGet } = plaidReturning([
      {
        investment_transactions: [buy, deposit],
        securities: [{ security_id: 'sec-vti', ticker_symbol: 'VTI', type: 'etf', option_contract: null }],
        total: 2,
      },
    ])

    const activity = await investmentRepository.getAccountActivity(client, 'token-1', 'acc-1', '2023-03-01', '2025-03-31')

    expect(investmentsTransactionsGet).toHaveBeenCalledWith({
      access_token: 'token-1',
      start_date: '2023-03-01',
      end_date: '2025-03-31',
      options: { account_ids: ['acc-1'], count: 500, offset: 0 },
    })
    expect(activity.transactions).toEqual([
      {
        investmentTransactionId: 'it-buy',
        date: '2025-03-03',
        securityId: 'sec-vti',
        type: 'buy',
        subtype: 'buy',
        quantity: 10,
        amount: 2500,
        price: 250,
        isCashTransfer: false,
      },
      {
        investmentTransactionId: 'it-dep',
        date: '2025-03-01',
        securityId: null,
        type: 'cash',
        subtype: 'deposit',
        quantity: 0,
        amount: -3000,
        price: 0,
        // The same test the feed's filter uses: money crossing the account boundary, which the
        // chart's gain leaves out.
        isCashTransfer: true,
      },
    ])
    expect(activity.securities).toEqual([{ securityId: 'sec-vti', ticker: 'VTI', type: 'etf', isOption: false }])
  })

  it('collects securities from every page, once each', async () => {
    const { client } = plaidReturning([
      {
        investment_transactions: [buy],
        securities: [{ security_id: 'sec-vti', ticker_symbol: 'VTI', type: 'etf' }],
        total: 2,
      },
      {
        investment_transactions: [{ ...buy, investment_transaction_id: 'it-2', security_id: 'sec-aapl' }],
        securities: [
          { security_id: 'sec-vti', ticker_symbol: 'VTI', type: 'etf' },
          { security_id: 'sec-aapl', ticker_symbol: 'AAPL', type: 'equity' },
        ],
        total: 2,
      },
    ])

    const activity = await investmentRepository.getAccountActivity(client, 't', 'acc-1', '2023-03-01', '2025-03-31')

    expect(activity.transactions).toHaveLength(2)
    expect(activity.securities.map((s) => s.securityId)).toEqual(['sec-vti', 'sec-aapl'])
  })
})
