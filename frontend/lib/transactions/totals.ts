import type { FeedItem } from './resolveFeed'

/**
 * Either leg of a transfer — the expense side or the linked income side. Answers "is there a
 * Transfer record here?", which is what the edit sheets need in order to offer unmark/undo.
 * For "should this count as spending", use isInternalMovement instead.
 */
export function isTransfer(item: FeedItem): boolean {
  return item.transferKind !== null
}

/**
 * PFC codes that describe money moving inside the user's own holdings, excluded from totals
 * even with no Transfer record to pair them against.
 *
 * Applied ONLY on brokerage cash accounts (isBrokerageCashAccount) — the one place transfer
 * pairing structurally cannot reach. A sweep's counterpart is either an investment transaction,
 * served by /investments/transactions/get rather than /transactions/sync, or (as Fidelity reports
 * it) a second leg on the very same account, which autoMatch's pairAllowed rejects. Either way no
 * transfer record can ever exist, so PFC is the only signal available.
 *
 * On every other account these codes are deliberately NOT excluded. autoMatch pairs a linked
 * counterpart and sets transferKind (which this predicate honours regardless of account), and an
 * unpaired leg is left counted on purpose — the design's stated bias is to leave money counted
 * rather than wrongly hide it. Excluding globally would silently override that.
 *
 * The four *_INVESTMENT_AND_RETIREMENT_FUNDS / *_SAVINGS codes are byte-identical across PFCv1 and
 * PFCv2, verified against Plaid's published taxonomy; TRANSFER_IN_ACCOUNT_TRANSFER is the v2
 * spelling. transactionRepository.sync pins v2, but the check still matters: an Item synced before
 * the pin cached rows categorized under v1, and those rows stay in MMKV.
 *
 * Kept deliberately narrow. Each of these is money the user still holds, with no purchase
 * hiding behind it. Excluded from the set, with Plaid's own descriptions as the reason:
 *  - LOAN_PAYMENTS_CREDIT_CARD_PAYMENT — when the card IS linked, autoMatch pairs it and the
 *    transfer record covers it. When it isn't, the payment is the only visible proxy for the
 *    purchases made on that card, so dropping it would make spend totals under-count.
 *  - TRANSFER_IN_DEPOSIT — "Cash, checks, and ATM deposits into a bank account": money arriving
 *    from outside, not shifted between the user's own accounts.
 *  - TRANSFER_OUT_WITHDRAWAL — "Withdrawals from a bank account"; the cash gets spent later.
 *  - TRANSFER_OUT_ACCOUNT_TRANSFER — "General outbound transfers". Plaid's taxonomy has no
 *    peer-to-peer code at all, so Venmo/Zelle to a person lands here next to genuine internal
 *    moves, as does ACH rent. Excluding it would hide real spending; pairing handles the
 *    account-to-account case, and that path sets transferKind.
 *
 * Its inbound twin IS in the set, and the asymmetry is the point. A brokerage funds what you spend
 * from its cash account by redeeming the core money-market position, and tags the resulting inflow
 * inconsistently — the same institution used TRANSFER_IN_INVESTMENT_AND_RETIREMENT_FUNDS on some
 * days and the generic code on others for the identical event. Nothing arriving INTO a brokerage
 * cash account under a generic account-transfer code is somebody else's money, so the objection
 * above (hiding real spending) has no inbound equivalent: the worst case is understating income by
 * the size of a redemption the user still holds. Pairing cannot be relied on to catch it either —
 * a redemption is sized to the payment it funds, so it collides on amount with unrelated movements
 * and gets mislinked to them (autoMatch's pairAllowed reads this predicate to refuse exactly that).
 */
const INTERNAL_MOVEMENT_PFC = new Set([
  'TRANSFER_OUT_INVESTMENT_AND_RETIREMENT_FUNDS',
  'TRANSFER_IN_INVESTMENT_AND_RETIREMENT_FUNDS',
  'TRANSFER_OUT_SAVINGS',
  'TRANSFER_IN_SAVINGS',
  // Inbound only — see the asymmetry note above.
  'TRANSFER_IN_ACCOUNT_TRANSFER',
])

/**
 * Money that moved between the user's own accounts or holdings rather than being spent or
 * earned — whether that was established by pairing two legs into a Transfer record, or by
 * Plaid's own PFC on a movement whose counterpart the feed can't see.
 */
export function isInternalMovement(item: FeedItem): boolean {
  if (isTransfer(item)) return true
  if (!item.isBrokerageCashAccount) return false
  return item.pfcDetailed !== null && INTERNAL_MOVEMENT_PFC.has(item.pfcDetailed)
}

/**
 * Excluded specifically as a brokerage-cash sweep — not as a transfer leg (which already carries
 * its own badge) and not as a reimbursement leg (which has its own icon and title). These are the
 * rows that would otherwise be greyed out with nothing on them explaining why, so the UI badges
 * them "Investment".
 */
export function isInvestmentSweep(item: FeedItem): boolean {
  if (isTransfer(item) || item.isReimbursementIncome) return false
  // An equal counterpart on another account means the money crossed an account boundary, which a
  // sweep into holdings never does. The row is still excluded — it IS internal movement — but a
  // brokerage's own TRANSFER_OUT_INVESTMENT code on an ACH to the user's bank does not make it an
  // investment, and saying so sends them looking for a trade that never happened.
  if (item.hasCrossAccountCounterpart) return false
  if (item.isSweptOutflow) return true
  return isInternalMovement(item)
}

/**
 * Excluded, brokerage-flavoured, and yet demonstrably a move between two of the user's accounts —
 * the counterpart is in the feed, it just has no Transfer record yet because autoMatch could only
 * suggest the pair rather than auto-apply it.
 *
 * Exists so the row can say so. isInvestmentSweep stops claiming these, and without a second label
 * they would grey out with nothing on them explaining why, which is the confusion that pill was
 * added to prevent in the first place.
 */
export function isUnlinkedInternalTransfer(item: FeedItem): boolean {
  if (isTransfer(item) || item.isReimbursementIncome) return false
  // Pending is why a pending row is greyed — not this. It also has no business being classified
  // at all until the bank settles it, since the amount can still move.
  if (item.pending) return false
  if (!item.hasCrossAccountCounterpart) return false
  return !countsTowardTotals(item)
}

// Single predicate for "does this item belong in spend/income aggregates", so the donut, top
// merchants, the daily chart and the per-day IN/OUT rows can never disagree about what counts.
//
// Excluded:
//  - a reimbursement's income leg, already netted out of its expense — counting it double-credits;
//  - internal movement, which is money shifted between the user's own accounts or holdings, not
//    spending or income. Unpaired transfers are excluded too: the money still didn't leave the user;
//  - a swept outflow (applySweepExclusion): a brokerage-cash outflow that only mirrors an equal
//    inflow on the same account. Asymmetric by design — its inflow is often real income (a
//    dividend, then swept), so only the outflow is dropped;
//  - a pending transaction: the app counts money when the bank settles it, matching the settled
//    balances it displays (Plaid's `current`). A pending row is shown and labelled, its amount
//    greyed by this same predicate, and it starts counting the moment it posts. Counting it
//    earlier made Expenses/Income disagree with every balance on the accounts screen — and
//    pending amounts aren't final anyway (tips, holds).
//
// Investment-source rows need no special case here. Only cash crossing the account boundary is
// ingested (the backend filters trades, fees and dividends at the source), so an investment row is
// always household money: it counts when nothing pairs it, and is excluded by isInternalMovement
// when something does.
export function countsTowardTotals(item: FeedItem): boolean {
  return !item.pending && !item.isReimbursementIncome && !isInternalMovement(item) && !item.isSweptOutflow
}
