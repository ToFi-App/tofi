import { isBrokerageCashAccount } from '@/lib/accounts/accountType'
import type { InvestmentTransaction, ManualTransaction, PlaidCategoryMapping, PlaidTransaction, TransactionOverride, Transfer, TransferKind, VendorMapping } from '@/types/domain'

export type CategorySource = 'override' | 'user_defined' | 'plaid_auto' | 'plaid_pfc' | 'mcc_pfc' | 'uncategorized'

export interface ResolvedCategory {
  categoryId: string | null
  subcategoryId: string | null
  categorySource: CategorySource
}

// Implements product.md's category resolution order:
// transaction_overrides > user_defined vendor_mappings > plaid_auto vendor_mappings >
// the transaction's own PFC via plaid_category_mappings > Uncategorized.
//
// The PFC step exists because the three steps above it are all keyed on merchant_name, which
// Plaid leaves null for everything it can't merchant-enrich (ACH, checks, Zelle, direct
// deposits), and because plaid_auto vendor_mappings are only generated once during onboarding,
// so any merchant first seen afterwards has no row. Both cases arrive carrying a perfectly good
// personal_finance_category, so resolving it here is what keeps them out of Uncategorized.
export function resolveCategory(
  txn: {
    transactionId: string
    merchantName: string | null
    pfcPrimary?: string | null
    pfcDetailed?: string | null
    /**
     * Where the PFC came from. FinanceKit transactions carry an ISO 18245 MCC rather than a PFC,
     * so the caller translates it (lib/financekit/mccToPfc.ts) and labels it 'mcc' — the resolution
     * order is identical either way, but reporting a crosswalked code as 'plaid_pfc' would be a
     * lie wherever categorySource is surfaced. Defaults to 'plaid'.
     */
    pfcSource?: 'plaid' | 'mcc'
  },
  overrides: TransactionOverride[],
  vendorMappings: VendorMapping[],
  plaidCategoryMappings: PlaidCategoryMapping[] = [],
): ResolvedCategory {
  const override = overrides.find((o) => o.plaidTransactionId === txn.transactionId)
  if (override) {
    return { categoryId: override.categoryId, subcategoryId: override.subcategoryId, categorySource: 'override' }
  }

  const userDefined = txn.merchantName
    ? vendorMappings.find((v) => v.vendorName === txn.merchantName && v.source === 'user_defined')
    : undefined
  if (userDefined) {
    return { categoryId: userDefined.categoryId, subcategoryId: userDefined.subcategoryId, categorySource: 'user_defined' }
  }

  const plaidAuto = txn.merchantName
    ? vendorMappings.find((v) => v.vendorName === txn.merchantName && v.source === 'plaid_auto')
    : undefined
  if (plaidAuto) {
    return { categoryId: plaidAuto.categoryId, subcategoryId: plaidAuto.subcategoryId, categorySource: 'plaid_auto' }
  }

  // Detailed code first (more precise), then the primary. The primary pass prefers an explicit
  // primary-only row (plaid_pfc_detailed IS NULL, the convention product.md describes) but falls
  // back to any row sharing the primary, since seedCategories only ever writes detailed rows —
  // otherwise a detailed code Plaid adds later would land in Uncategorized despite its whole
  // primary being mapped.
  const pfcMatch = txn.pfcDetailed
    ? plaidCategoryMappings.find((m) => m.plaidPfcDetailed === txn.pfcDetailed)
    : undefined
  const primaryMatch =
    !pfcMatch && txn.pfcPrimary
      ? (plaidCategoryMappings.find((m) => m.plaidPfcPrimary === txn.pfcPrimary && m.plaidPfcDetailed === null) ??
        plaidCategoryMappings.find((m) => m.plaidPfcPrimary === txn.pfcPrimary))
      : undefined
  const resolvedFromPfc = pfcMatch ?? primaryMatch
  if (resolvedFromPfc) {
    // No subcategory: plaid_category_mappings binds a PFC code to a category only, and
    // subcategories are user-defined refinements with no Plaid equivalent.
    return {
      categoryId: resolvedFromPfc.categoryId,
      subcategoryId: null,
      categorySource: txn.pfcSource === 'mcc' ? 'mcc_pfc' : 'plaid_pfc',
    }
  }

  return { categoryId: null, subcategoryId: null, categorySource: 'uncategorized' }
}

/**
 * One link this transaction is part of — the other leg of a transfer, or one of the
 * reimbursements paid against an expense.
 *
 * Carries a snapshot of the counterpart (merchant, date, amount, account) rather than just its id: the
 * surfaces that display links are usually handed a filtered slice of the feed — one account's
 * rows, one category's rows — in which the counterpart isn't present to look up. Rebuilt on every
 * feed derivation, so the snapshot can't drift, and it never nests (a link carries no links).
 */
export interface FeedLink {
  /** The transfer row's own id, so one link can be removed without disturbing the others. */
  recordId: string
  kind: TransferKind
  /** The counterpart's feed id, or null when the other leg isn't in the feed: an unpaired
   *  transfer, or a counterpart outside the synced window. */
  itemId: string | null
  merchantName: string | null
  date: string | null
  /** The counterpart's account, so link rows can show the same bank chip the feed row does. */
  accountId: string | null
  /** What this link recorded: the reimbursed amount for a reimbursement, the moved amount
   *  otherwise. Always positive. */
  amount: number
}

export interface FeedItem {
  id: string
  source: 'plaid' | 'manual' | 'investment'
  amount: number // Plaid convention: positive = money out (expense), negative = money in (income)
  /**
   * The day the user actually made the transaction: Plaid's `authorized_date` when the institution
   * supplies one, its posted `date` otherwise. This is the DISPLAY and BUCKETING date — day
   * headers, month filtering, aggregation. It is deliberately not the matching date; see
   * `postedDate`.
   *
   * Preferring authorized also makes a row's date stable across settlement. Plaid's `date` means
   * "occurred" while pending and flips to "posted" once settled, so a row keyed on it can jump a
   * day or two — and across a month boundary, between months — after the user has already seen it.
   */
  date: string
  /**
   * Plaid's `date` verbatim, i.e. the posted date (the occurred date while still pending).
   *
   * Every transaction-to-transaction date comparison reads THIS field, never `date`. The reason is
   * that `authorized_date` is nullable and unevenly populated: within a single pair, one leg can
   * carry it while the other does not, so the two would be measured on different bases and the
   * apparent gap between them would be off by however long the institution took to post. Sweep
   * exclusion compares on amount alone inside a 1-day window, so a drift that small is enough to
   * make it miss and let a swept outflow count as real spending. Plaid guarantees `date`, so
   * matching on it is the basis that cannot go asymmetric.
   */
  postedDate: string
  merchantName: string
  categoryId: string | null
  subcategoryId: string | null
  categorySource: CategorySource
  confidenceLevel: string | null
  // Plaid's PFC detailed code (e.g. 'LOAN_PAYMENTS_CREDIT_CARD_PAYMENT'), null for manual
  // transactions. Carried for transfer auto-detection's confidence gate — category display
  // still goes through the resolution chain above, never this raw code.
  pfcDetailed: string | null
  accountId: string | null
  pending: boolean
  note: string | null
  reimbursedAmount: number | null
  netAmount: number | null
  isReimbursementIncome: boolean
  reimbursementCategoryId: string | null
  transferId: string | null
  transferKind: TransferKind | null
  transferRole: 'expense' | 'income' | null
  // Who created the transfer this leg belongs to: 'auto' = transfer auto-detection, so the
  // UI can badge it and offer one-tap undo. Null when the item isn't a transfer leg.
  transferSource: 'manual' | 'auto' | null
  // Whether this row sits on a brokerage cash account (Plaid 'cash management' subtype, or an
  // investment account). Resolved here rather than looked up downstream so the totals predicates
  // stay item-only. False for manual transactions, which have no account.
  isBrokerageCashAccount: boolean
  // Set by applySweepExclusion (runs last): this outflow only mirrors an equal inflow on the same
  // brokerage cash account, i.e. a sweep into holdings rather than spending.
  isSweptOutflow: boolean
  // Also set by applySweepExclusion: an equal, opposite-signed row exists on a DIFFERENT account
  // inside autoMatch's window. Money that crossed an account boundary, whatever Plaid's code on it
  // says — which is what separates a transfer from a sweep into holdings. Only the label reads
  // this; whether the row counts is unaffected either way.
  hasCrossAccountCounterpart: boolean
  /** Every link this transaction is part of, either leg. Empty when it isn't linked to anything. */
  links: FeedLink[]
}

export function mergeFeed(
  // Widened to carry pfcSource: FinanceKit rows arrive Plaid-shaped but with a PFC crosswalked from
  // an ISO 18245 MCC (lib/financekit/toFeedTransactions.ts). Optional, so Plaid callers are
  // unaffected and default to 'plaid'.
  plaidTransactions: (PlaidTransaction & { pfcSource?: 'plaid' | 'mcc' })[],
  manualTransactions: ManualTransaction[],
  overrides: TransactionOverride[],
  vendorMappings: VendorMapping[],
  plaidCategoryMappings: PlaidCategoryMapping[] = [],
  accounts: Array<{ account_id: string; type: string; subtype?: string | null }> = [],
  investmentTransactions: InvestmentTransaction[] = [],
): FeedItem[] {
  const brokerageCashAccountIds = new Set(
    accounts.filter(isBrokerageCashAccount).map((account) => account.account_id),
  )

  const overrideNoteById = new Map(overrides.filter((o) => o.note != null).map((o) => [o.plaidTransactionId, o.note]))

  const plaidItems: FeedItem[] = plaidTransactions.map((txn) => {
    const resolved = resolveCategory(
      {
        transactionId: txn.transaction_id,
        merchantName: txn.merchant_name ?? null,
        pfcPrimary: txn.personal_finance_category?.primary ?? null,
        pfcDetailed: txn.personal_finance_category?.detailed ?? null,
        pfcSource: txn.pfcSource,
      },
      overrides,
      vendorMappings,
      plaidCategoryMappings,
    )
    return {
      id: txn.transaction_id,
      source: 'plaid',
      amount: txn.amount,
      date: txn.authorized_date ?? txn.date,
      postedDate: txn.date,
      merchantName: txn.merchant_name ?? txn.name,
      categoryId: resolved.categoryId,
      subcategoryId: resolved.subcategoryId,
      categorySource: resolved.categorySource,
      confidenceLevel: txn.personal_finance_category?.confidence_level ?? null,
      pfcDetailed: txn.personal_finance_category?.detailed ?? null,
      accountId: txn.account_id,
      pending: txn.pending,
      // A Plaid transaction's note lives in its override row — the same per-transaction edit
      // that carries a category change carries the user's description.
      note: overrideNoteById.get(txn.transaction_id) ?? null,
      reimbursedAmount: null,
      netAmount: null,
      isReimbursementIncome: false,
      reimbursementCategoryId: null,
      transferId: null,
      transferKind: null,
      transferRole: null,
      transferSource: null,
      isBrokerageCashAccount: brokerageCashAccountIds.has(txn.account_id),
      isSweptOutflow: false,
      hasCrossAccountCounterpart: false,
      links: [],
    }
  })

  const manualItems: FeedItem[] = manualTransactions.map((txn) => ({
    id: txn.id,
    source: 'manual',
    amount: txn.type === 'expense' ? Number(txn.amount) : -Number(txn.amount),
    date: txn.date,
    postedDate: txn.date,
    merchantName: txn.note ?? (txn.type === 'expense' ? 'Manual expense' : 'Manual income'),
    categoryId: txn.categoryId,
    subcategoryId: txn.subcategoryId,
    categorySource: txn.categoryId ? 'user_defined' : 'uncategorized',
    confidenceLevel: null,
    pfcDetailed: null,
    accountId: null,
    pending: false,
    note: txn.note,
    reimbursedAmount: null,
    netAmount: null,
    isReimbursementIncome: false,
    reimbursementCategoryId: null,
    transferId: null,
    transferKind: null,
    transferRole: null,
    transferSource: null,
    isBrokerageCashAccount: false,
    isSweptOutflow: false,
    hasCrossAccountCounterpart: false,
    links: [],
  }))

  // Investment transactions are a third source, not a variant of the Plaid one: they come from a
  // different endpoint with no PFC, no pending state and no merchant enrichment. They are here so
  // detectTransfers can find the counterpart to a checking->brokerage outflow, which
  // /transactions/sync never returns.
  //
  // Only cash crossing the account boundary reaches this point — trades, fees and dividends are
  // filtered out in the backend repository (CASH_TRANSFER_SUBTYPES) and never cross the wire. That
  // is why no row here needs a "is this portfolio activity" flag: by construction, none of it is.
  const investmentItems: FeedItem[] = investmentTransactions.map((txn) => {
    const merchantName = txn.name
    const resolved = resolveCategory(
      { transactionId: txn.investmentTransactionId, merchantName },
      overrides,
      vendorMappings,
      plaidCategoryMappings,
    )
    return {
      id: txn.investmentTransactionId,
      source: 'investment',
      // No sign flip: Plaid's investment amount is already positive-is-money-out.
      amount: txn.amount,
      date: txn.date,
      postedDate: txn.date,
      merchantName,
      categoryId: resolved.categoryId,
      subcategoryId: resolved.subcategoryId,
      categorySource: resolved.categorySource,
      confidenceLevel: null,
      // No personal_finance_category on this endpoint. Left null rather than synthesized: a fake
      // PFC code would make these rows drivers in autoMatch, and only the DEBIT side should drive.
      pfcDetailed: null,
      accountId: txn.accountId,
      pending: false,
      note: null,
      reimbursedAmount: null,
      netAmount: null,
      isReimbursementIncome: false,
      reimbursementCategoryId: null,
      transferId: null,
      transferKind: null,
      transferRole: null,
      transferSource: null,
      isBrokerageCashAccount: brokerageCashAccountIds.has(txn.accountId),
      isSweptOutflow: false,
      hasCrossAccountCounterpart: false,
      links: [],
    }
  })

  return [...plaidItems, ...manualItems, ...investmentItems].sort((a, b) =>
    a.date < b.date ? 1 : a.date > b.date ? -1 : 0,
  )
}

/**
 * Builds one leg's view of a link. The counterpart is looked up rather than trusted: an id can
 * point outside the synced window, which reads the same as an unpaired leg — a link the sheet
 * shows but can't name.
 */
function toLink(
  recordId: string,
  kind: TransferKind,
  counterpartId: string | null | undefined,
  amount: number,
  itemById: Map<string, FeedItem>,
): FeedLink {
  const counterpart = counterpartId ? itemById.get(counterpartId) ?? null : null
  return {
    recordId,
    kind,
    itemId: counterpart?.id ?? null,
    merchantName: counterpart?.merchantName ?? null,
    date: counterpart?.date ?? null,
    accountId: counterpart?.accountId ?? null,
    amount: Math.abs(amount),
  }
}

function legIds(record: {
  expensePlaidTransactionId: string | null
  expenseManualTransactionId: string | null
  incomePlaidTransactionId: string | null
  incomeManualTransactionId: string | null
}): { expenseId: string | null; incomeId: string | null } {
  return {
    expenseId: record.expensePlaidTransactionId ?? record.expenseManualTransactionId,
    incomeId: record.incomePlaidTransactionId ?? record.incomeManualTransactionId,
  }
}

// Stamps both legs of every transfer so downstream code can badge them and leave them out of
// totals. A transfer may be unpaired (no income leg), in which case only the expense is stamped.
// Reimbursement-kind transfers are handled differently: the expense leg gets reimbursedAmount /
// netAmount, and the income leg is marked as reimbursement income — they are NOT excluded from
// totals the way other transfer kinds are.
export function applyTransfers(feed: FeedItem[], transfers: Transfer[]): FeedItem[] {
  const nonReimbursement: Transfer[] = []
  const reimbursementTransfers: Transfer[] = []
  for (const t of transfers) {
    if (t.kind === 'reimbursement') reimbursementTransfers.push(t)
    else nonReimbursement.push(t)
  }

  // --- Non-reimbursement transfers: 1:1, stamp transferId/Kind/Role ---
  const byExpenseId = new Map<string, Transfer>()
  const byIncomeId = new Map<string, Transfer>()
  for (const transfer of nonReimbursement) {
    const expenseId = transfer.expensePlaidTransactionId ?? transfer.expenseManualTransactionId
    if (expenseId) byExpenseId.set(expenseId, transfer)
    const incomeId = transfer.incomePlaidTransactionId ?? transfer.incomeManualTransactionId
    if (incomeId) byIncomeId.set(incomeId, transfer)
  }

  // --- Reimbursement transfers: many-to-one on expense side ---
  const reimbByExpenseId = new Map<string, Transfer[]>()
  const reimbByIncomeId = new Map<string, Transfer>()
  for (const t of reimbursementTransfers) {
    const expenseId = t.expensePlaidTransactionId ?? t.expenseManualTransactionId
    if (expenseId) {
      const list = reimbByExpenseId.get(expenseId) ?? []
      list.push(t)
      reimbByExpenseId.set(expenseId, list)
    }
    const incomeId = t.incomePlaidTransactionId ?? t.incomeManualTransactionId
    if (incomeId) reimbByIncomeId.set(incomeId, t)
  }

  const categoryByFeedId = new Map(feed.map((item) => [item.id, item.categoryId]))
  const itemById = new Map(feed.map((item) => [item.id, item]))

  return feed.map((item) => {
    // Non-reimbursement transfer legs
    const asExpense = byExpenseId.get(item.id)
    if (asExpense) {
      return {
        ...item,
        transferId: asExpense.id,
        transferKind: asExpense.kind,
        transferRole: 'expense' as const,
        transferSource: asExpense.source,
        links: [toLink(asExpense.id, asExpense.kind, legIds(asExpense).incomeId, Number(asExpense.amount), itemById)],
      }
    }
    const asIncome = byIncomeId.get(item.id)
    if (asIncome) {
      return {
        ...item,
        transferId: asIncome.id,
        transferKind: asIncome.kind,
        transferRole: 'income' as const,
        transferSource: asIncome.source,
        links: [toLink(asIncome.id, asIncome.kind, legIds(asIncome).expenseId, Number(asIncome.amount), itemById)],
      }
    }

    // Reimbursement expense side: accumulate amounts, set netAmount. One expense can be paid back
    // by several incomes, so this leg carries a link per reimbursement, each with its own amount.
    const reimbLinks = reimbByExpenseId.get(item.id)
    if (reimbLinks) {
      const reimbursedAmount = reimbLinks.reduce((sum, t) => sum + Number(t.amount), 0)
      const netAmount = Math.max(0, item.amount - reimbursedAmount)
      const links = reimbLinks.map((t) => toLink(t.id, t.kind, legIds(t).incomeId, Number(t.amount), itemById))
      return { ...item, reimbursedAmount, netAmount, links }
    }

    // Reimbursement income side: mark as reimbursement income, carry expense's category
    const reimbIncome = reimbByIncomeId.get(item.id)
    if (reimbIncome) {
      const { expenseId } = legIds(reimbIncome)
      const expenseCategoryId = expenseId ? categoryByFeedId.get(expenseId) ?? null : null
      return {
        ...item,
        isReimbursementIncome: true,
        reimbursementCategoryId: expenseCategoryId,
        links: [toLink(reimbIncome.id, reimbIncome.kind, expenseId, Number(reimbIncome.amount), itemById)],
      }
    }

    return item
  })
}
