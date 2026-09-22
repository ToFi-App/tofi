import { describe, expect, it } from 'vitest'
import { toFeedTransactions } from './toFeedTransactions'
import { mergeFeed } from '@/lib/transactions/resolveFeed'
import type { AdaptedTransaction } from './adaptTransaction'

function adapted(overrides: Partial<AdaptedTransaction> = {}): AdaptedTransaction {
  return {
    transaction_id: 'fk-1',
    account_id: 'acc-card',
    name: 'BLUE BOTTLE',
    original_description: 'BLUE BOTTLE #4',
    merchant_name: 'Blue Bottle',
    mcc: '5814',
    amount: 6.5,
    iso_currency_code: 'USD',
    date: '2026-08-21',
    transactionDate: '2026-08-20T14:03:00.000Z',
    pending: false,
    personal_finance_category: null,
    ...overrides,
  }
}

describe('toFeedTransactions', () => {
  it('fills personal_finance_category from the MCC at read time', () => {
    const [row] = toFeedTransactions([adapted()])
    expect(row.personal_finance_category).toEqual({
      primary: 'FOOD_AND_DRINK',
      detailed: 'FOOD_AND_DRINK_FAST_FOOD',
      confidence_level: null,
    })
  })

  it('marks the PFC as MCC-derived so it is never reported as Plaid’s own', () => {
    expect(toFeedTransactions([adapted()])[0].pfcSource).toBe('mcc')
  })

  it('leaves the category null when the MCC is unmapped, so it falls through to uncategorized', () => {
    const [row] = toFeedTransactions([adapted({ mcc: '9999' })])
    expect(row.personal_finance_category).toBeNull()
  })

  it('preserves the fields the feed reads', () => {
    const [row] = toFeedTransactions([adapted()])
    expect(row).toMatchObject({
      transaction_id: 'fk-1',
      account_id: 'acc-card',
      amount: 6.5,
      date: '2026-08-21',
      pending: false,
      merchant_name: 'Blue Bottle',
    })
  })
})

describe('an Apple Card transaction through the whole feed chain', () => {
  it('resolves to the user’s category and reports categorySource mcc_pfc', () => {
    const feed = mergeFeed(
      toFeedTransactions([adapted()]),
      [],
      [],
      [],
      [{ id: 'pm1', plaidPfcPrimary: 'FOOD_AND_DRINK', plaidPfcDetailed: 'FOOD_AND_DRINK_FAST_FOOD', categoryId: 'cat-food' }] as never,
      [{ account_id: 'acc-card', type: 'credit', subtype: 'credit card' }],
    )

    expect(feed).toHaveLength(1)
    expect(feed[0]).toMatchObject({ categoryId: 'cat-food', categorySource: 'mcc_pfc' })
  })
})

describe('toFeedTransactions date basis', () => {
  // FinanceKit gives both dates on every row: postedDate (nullable) and transactionDate (the
  // authorization, always present). adaptTransaction folds the first into `date`; this carries the
  // second as authorized_date so resolveFeed treats an Apple Card row exactly like a Plaid one
  // instead of falling back to the posted date for the whole account.
  it('carries the authorization date as authorized_date', () => {
    const [row] = toFeedTransactions([adapted({ date: '2026-08-21', transactionDate: '2026-08-20T14:03:00.000Z' })])
    expect(row.authorized_date).toBe('2026-08-20')
  })

  it('reduces the authorization timestamp to a date, since groupByDay buckets on it verbatim', () => {
    const [row] = toFeedTransactions([adapted({ transactionDate: '2026-08-20T14:03:00.000Z' })])
    expect(row.authorized_date).not.toContain('T')
  })

  it('shows the authorized date once the row reaches the feed', () => {
    const rows = toFeedTransactions([adapted({ date: '2026-08-21', transactionDate: '2026-08-20T14:03:00.000Z' })])
    const [feedItem] = mergeFeed(rows, [], [], [])
    expect(feedItem).toMatchObject({ date: '2026-08-20', postedDate: '2026-08-21' })
  })
})

describe('toFeedTransactions authorized_date basis', () => {
  it('derives authorized_date from the local calendar day of the authorization', () => {
    const transactionDate = new Date(2026, 7, 20, 21, 5).toISOString()
    const [row] = toFeedTransactions([adapted({ transactionDate })])
    expect(row.authorized_date).toBe('2026-08-20')
  })
})
