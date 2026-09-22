import { describe, expect, it } from 'vitest'
import { adaptTransaction } from './adaptTransaction'
import type { RawTransaction } from './types'

const base: RawTransaction = {
  id: 'F1A2B3C4-0000-0000-0000-000000000001',
  accountID: 'ACC00000-0000-0000-0000-000000000001',
  amount: 12.34,
  currencyCode: 'USD',
  creditDebitIndicator: 'debit',
  transactionDescription: 'BLUE BOTTLE COFFEE',
  originalTransactionDescription: 'BLUE BOTTLE COFFEE #421',
  merchantName: 'Blue Bottle Coffee',
  merchantCategoryCode: '5814',
  status: 'posted',
  transactionDate: '2026-08-20T14:03:00.000Z',
  postedDate: '2026-08-21T09:00:00.000Z',
}

describe('adaptTransaction', () => {
  it('maps FinanceKit identity and description fields onto the normalized shape', () => {
    const result = adaptTransaction(base)

    expect(result.transaction_id).toBe('F1A2B3C4-0000-0000-0000-000000000001')
    expect(result.account_id).toBe('ACC00000-0000-0000-0000-000000000001')
    expect(result.name).toBe('BLUE BOTTLE COFFEE')
    expect(result.original_description).toBe('BLUE BOTTLE COFFEE #421')
    expect(result.merchant_name).toBe('Blue Bottle Coffee')
  })

  it('signs a debit positive, following Plaid’s money-out-is-positive convention', () => {
    expect(adaptTransaction(base).amount).toBe(12.34)
  })

  it('signs a credit negative, so a refund reads as money in', () => {
    expect(adaptTransaction({ ...base, creditDebitIndicator: 'credit' }).amount).toBe(-12.34)
  })

  it('uses the posted date, as a plain YYYY-MM-DD, once a transaction has posted', () => {
    // Date only: groupByDay uses this verbatim as its bucket key and day header, so a full ISO
    // timestamp gives every transaction its own day and prints the raw string on screen.
    expect(adaptTransaction(base).date).toBe('2026-08-21')
  })

  it('falls back to the transaction date while a charge is still unposted', () => {
    const unposted = { ...base, status: 'pending' as const, postedDate: null }
    expect(adaptTransaction(unposted).date).toBe('2026-08-20')
  })

  it('marks an unposted transaction pending', () => {
    expect(adaptTransaction({ ...base, status: 'pending' }).pending).toBe(true)
  })

  it('does not mark a posted transaction pending', () => {
    expect(adaptTransaction(base).pending).toBe(false)
  })

  it('carries the MCC through without categorizing', () => {
    const result = adaptTransaction(base)
    expect(result.mcc).toBe('5814')
    expect(result.personal_finance_category).toBeNull()
  })

  it('keeps the full authorization timestamp for window partitioning', () => {
    expect(adaptTransaction(base).transactionDate).toBe('2026-08-20T14:03:00.000Z')
  })
})

describe('adaptTransaction date basis', () => {
  // Inputs are built from LOCAL components and then converted to ISO, so every assertion here is
  // "the local calendar day of this instant" and holds in any timezone. Slicing the UTC string
  // instead lands on the next day west of UTC and the previous day east of it, so the two cases
  // below cover both directions — only one of them can fail on any given machine.
  it('buckets a late-evening purchase on the local day, not the UTC one', () => {
    const postedDate = new Date(2026, 7, 20, 20, 30).toISOString()
    expect(adaptTransaction({ ...base, postedDate }).date).toBe('2026-08-20')
  })

  it('buckets an early-morning purchase on the local day, not the UTC one', () => {
    const postedDate = new Date(2026, 7, 20, 0, 30).toISOString()
    expect(adaptTransaction({ ...base, postedDate }).date).toBe('2026-08-20')
  })

  it('applies the same local basis to the fallback while a charge is still unposted', () => {
    const transactionDate = new Date(2026, 7, 20, 23, 15).toISOString()
    const unposted = { ...base, status: 'pending' as const, postedDate: null, transactionDate }
    expect(adaptTransaction(unposted).date).toBe('2026-08-20')
  })
})
