import { toDateKey } from '@/lib/dates/dateKey'
import type { RawTransaction } from './types'

/**
 * FinanceKit transaction → the normalized transaction shape the feed already carries.
 *
 * Purely structural: it does not categorize. merchantCategoryCode is carried through as `mcc` and
 * the PFC fields are left null, because the crosswalk runs at resolve time — see mccToPfc.ts for
 * why baking a category in at ingest would be unfixable.
 */
export interface AdaptedTransaction {
  transaction_id: string
  account_id: string
  name: string
  original_description: string | null
  merchant_name: string | null
  /** ISO 18245 merchant category code. The FinanceKit-only field the crosswalk reads. */
  mcc: string | null
  amount: number
  iso_currency_code: string
  date: string
  /**
   * The authorization timestamp, full ISO, kept only so planWindowedMerge can partition the cache
   * on the same field the fetch predicate filters on. `date` is the posted date and cannot serve:
   * a charge authorized before the window but posted inside it belongs to neither half, and used to
   * be silently dropped.
   */
  transactionDate: string
  pending: boolean
  personal_finance_category: null
}

/**
 * FinanceKit reports a non-negative amount plus a direction; Plaid signs the amount, positive for
 * money out. Isolated here so that if real data disagrees with this reading of
 * creditDebitIndicator, the correction is one line rather than a hunt.
 */
function signedAmount(amount: number, indicator: RawTransaction['creditDebitIndicator']): number {
  const magnitude = Math.abs(amount)
  return indicator === 'debit' ? magnitude : -magnitude
}

export function adaptTransaction(raw: RawTransaction): AdaptedTransaction {
  return {
    transaction_id: raw.id,
    account_id: raw.accountID,
    name: raw.transactionDescription,
    original_description: raw.originalTransactionDescription,
    merchant_name: raw.merchantName,
    mcc: raw.merchantCategoryCode,
    amount: signedAmount(raw.amount, raw.creditDebitIndicator),
    iso_currency_code: raw.currencyCode,
    // Date only, not a timestamp: Plaid's `date` is YYYY-MM-DD and groupByDay uses it verbatim as
    // its bucket key and day header. A full ISO string gives every transaction its own "day" and
    // prints the raw timestamp on screen.
    //
    // Via toDateKey rather than slicing the ISO string: the string is UTC (financeKitModule builds
    // it with toISOString), so slicing it filed an 8pm purchase under tomorrow for any device
    // behind UTC. The day the user experienced is the LOCAL one, which is also the basis manual
    // transactions and the "today" highlight already use.
    date: toDateKey(new Date(raw.postedDate ?? raw.transactionDate)),
    transactionDate: raw.transactionDate,
    pending: raw.status !== 'posted' && raw.status !== 'booked',
    personal_finance_category: null,
  }
}
