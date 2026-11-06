import type { FeedItem } from '@/lib/transactions/resolveFeed'
import { remainingIncome } from '@/lib/reimbursements/suggest'
import type { TransferKind } from '@/types/domain'

export interface TransferCreateInput {
  kind: TransferKind
  expensePlaidTransactionId: string | null
  expenseManualTransactionId: string | null
  incomePlaidTransactionId: string | null
  incomeManualTransactionId: string | null
  amount: string
  note: string | null
}

export interface PendingTransfer {
  kind: TransferKind
  counterpartIds: string[]
  /**
   * A reimbursement's share per counterpart, when the user split an income across expenses. Absent
   * means the default: each pair records all the income has left, and the feed caps it at what the
   * expense still owes.
   */
  amounts?: Record<string, number>
}

/**
 * Which id column a leg belongs in. There are three feed sources but only two column pairs:
 * investment rows share the *PlaidTransactionId columns with plaid ones, because both are
 * institution-supplied string ids while the manual columns are uuid-typed rows of our own.
 * That is already what the auto-apply path does (useTransactionFeed posts draft.expense.id /
 * draft.income.id straight into the plaid columns for any non-manual leg).
 *
 * Getting this wrong is not cosmetic: matching only 'plaid' left an investment leg null on all
 * four columns, so marking a contribution against its checking outflow persisted a transfer with
 * the outflow excluded and the investment leg never stamped — phantom income.
 */
function isPlaidLeg(item: FeedItem | null): item is FeedItem {
  return item != null && item.source !== 'manual'
}

// Every screen that lists transactions has to turn "this item, marked as <kind>, linked to these
// counterparts" into transfer rows. Shared so the Transactions tab, the dashboard and the account
// detail sheet can't drift apart on which leg is the expense or what amount gets recorded.
export function buildTransferInputs(item: FeedItem, pending: PendingTransfer, feed: FeedItem[]): TransferCreateInput[] {
  const isReimbursement = pending.kind === 'reimbursement'
  // No counterpart selected still creates a transfer: a one-legged transfer is how an item gets
  // excluded from totals when its other side isn't in the feed at all.
  const counterpartIds = pending.counterpartIds.length > 0 ? pending.counterpartIds : [null]

  return counterpartIds.map((counterpartId) => {
    const counterpart = counterpartId ? feed.find((i) => i.id === counterpartId) ?? null : null
    const isExpense = item.amount > 0
    const expenseItem = isExpense ? item : counterpart
    const incomeItem = isExpense ? counterpart : item
    return {
      kind: pending.kind,
      expensePlaidTransactionId: isPlaidLeg(expenseItem) ? expenseItem.id : null,
      expenseManualTransactionId: expenseItem?.source === 'manual' ? expenseItem.id : null,
      incomePlaidTransactionId: isPlaidLeg(incomeItem) ? incomeItem.id : null,
      incomeManualTransactionId: incomeItem?.source === 'manual' ? incomeItem.id : null,
      // A reimbursement records what came back, not what was spent, so its amount comes off the
      // income leg whichever side the user started from: the share the user gave this pair when
      // they split the income, otherwise all the income has left (the whole of it, unless other
      // reimbursements already used some). Every other kind pairs equal amounts, so the marked
      // item's own amount is fine.
      amount:
        isReimbursement && incomeItem
          ? (counterpartId && pending.amounts?.[counterpartId] != null
              ? pending.amounts[counterpartId]
              : remainingIncome(incomeItem)
            ).toFixed(2)
          : Math.abs(item.amount).toFixed(2),
      note: null,
    }
  })
}
