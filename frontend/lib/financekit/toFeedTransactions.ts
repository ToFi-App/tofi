import { toDateKey } from '@/lib/dates/dateKey'
import type { PlaidTransaction } from '@/types/domain'
import type { AdaptedTransaction } from './adaptTransaction'
import { mccToPfc } from './mccToPfc'

/**
 * A feed-ready transaction: Plaid's shape plus the marker saying its PFC was crosswalked from an
 * MCC rather than issued by Plaid. mergeFeed forwards `pfcSource` to resolveCategory, which uses it
 * only to label the result — the resolution order is identical either way.
 */
export type FeedTransaction = PlaidTransaction & { pfcSource?: 'plaid' | 'mcc' }

/**
 * Applies the MCC crosswalk and shapes FinanceKit rows for the feed.
 *
 * Called on read, every derivation — not at ingest. The FinanceKit sync is HistoryToken-driven, so
 * a transaction is fetched exactly once; a category written into the cache could never be corrected
 * without discarding every token and refetching all history. Doing it here means a crosswalk fix
 * lands on already-cached rows at the next render. The cost is one map lookup per row per
 * derivation, which is far less than aggregateMonth already does over the same array.
 */
export function toFeedTransactions(transactions: AdaptedTransaction[]): FeedTransaction[] {
  return transactions.map((txn) => {
    const { pfcPrimary, pfcDetailed } = mccToPfc(txn.mcc)

    return {
      transaction_id: txn.transaction_id,
      account_id: txn.account_id,
      name: txn.name,
      original_description: txn.original_description,
      merchant_name: txn.merchant_name,
      amount: txn.amount,
      iso_currency_code: txn.iso_currency_code,
      date: txn.date,
      // Date only, not the full timestamp adaptTransaction carries: resolveFeed prefers this over
      // `date` for display and groupByDay uses the result verbatim as its bucket key and day
      // header, so a timestamp here would give every row its own "day" and print on screen.
      // Local, for the same reason adaptTransaction's `date` is — see toDateKey.
      authorized_date: toDateKey(new Date(txn.transactionDate)),
      pending: txn.pending,
      // Null rather than a fabricated code when the MCC is unmapped, so the row falls through the
      // resolution chain to Uncategorized exactly as a Plaid transaction with no PFC does.
      personal_finance_category:
        pfcPrimary && pfcDetailed ? { primary: pfcPrimary, detailed: pfcDetailed, confidence_level: null } : null,
      pfcSource: 'mcc',
    } as FeedTransaction
  })
}
