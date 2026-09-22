// Automatic internal-transfer detection (docs/credit-card-payment-auto-transfer.md).
//
// Pure function over the resolved feed: finds debit->credit-card payments and
// account-to-account transfers by pairing the two legs on exact amount + date window +
// account type, gated by Plaid's PFC code. Never excludes a lone transaction — a single
// outflow is indistinguishable from a real expense — so every draft has both legs.
//
// Errors must bias toward *leaving money counted* (mild, self-correcting) over *wrongly
// hiding it* (dangerous). Every gate below exists for that asymmetry.

import { daysBetween } from './registry'
import { isBrokerageCashAccount, isLiabilityAccount } from '@/lib/accounts/accountType'
import { isInternalMovement } from '@/lib/transactions/totals'
import type { FeedItem } from '@/lib/transactions/resolveFeed'
import type { Account, TransferKind } from '@/types/domain'

/** Kinds this detector can produce. Reimbursements and refunds stay manual-only. */
export type AutoTransferKind = Extract<TransferKind, 'credit_card_payment' | 'account_transfer'>

export interface TransferDraft {
  kind: AutoTransferKind
  /** The money-out leg (amount > 0). */
  expense: FeedItem
  /** The money-in leg (amount < 0). */
  income: FeedItem
  /** Positive dollar amount shared by both legs. */
  amount: number
}

export interface AutoMatchResult {
  /** Unambiguous, exact-code matches — safe to persist as transfers (source 'auto'). */
  autoApply: TransferDraft[]
  /** Plausible matches needing a one-tap confirm. Never persisted automatically. */
  suggestions: TransferDraft[]
}

export interface AutoMatchInput {
  /** Full current resolved feed (post applyTransfers), i.e. the whole cache. */
  feed: FeedItem[]
  accounts: Account[]
  /**
   * Restrict *drivers* to these feed-item ids (the sync delta). The candidate index is
   * always built over the full feed — "drive the delta, index the full cache". Omit for
   * a full scan (account-link backfill).
   */
  deltaIds?: Set<string> | null
  /** Expense-leg ids the user has unmarked; never re-matched from either side. */
  dismissedIds?: Set<string>
}

/** Matching window. Card payments/ACH usually settle in 1-3 days; 7 gives slack. */
export const AUTO_MATCH_WINDOW_DAYS = 7

const CC_PAYMENT_CODE = 'LOAN_PAYMENTS_CREDIT_CARD_PAYMENT'
const TRANSFER_OUT_EXACT = 'TRANSFER_OUT_ACCOUNT_TRANSFER'
const TRANSFER_IN_EXACT = 'TRANSFER_IN_ACCOUNT_TRANSFER'
// Plaid's pair for money moving between a bank account and a brokerage. Both halves are named
// here deliberately: a contribution is tagged OUT on the checking side, a withdrawal IN, and
// promoting only one of them left withdrawals as suggestions while contributions auto-applied.
const TRANSFER_OUT_INVESTMENT = 'TRANSFER_OUT_INVESTMENT_AND_RETIREMENT_FUNDS'
const TRANSFER_IN_INVESTMENT = 'TRANSFER_IN_INVESTMENT_AND_RETIREMENT_FUNDS'

/** Integer cents so float amounts can be hash keys. */
function centsKey(item: FeedItem): number {
  return Math.round(Math.abs(item.amount) * 100)
}

function isCreditAccount(account: Account | undefined): boolean {
  return account?.type === 'credit'
}

/**
 * An investment row is, by construction, cash crossing the brokerage's boundary — the backend
 * ingests nothing else — so its counterpart is necessarily on some other account. That structural
 * fact is a stronger signal than any PFC guess, and it is the ONLY signal available when the bank
 * side carries no transfer code: investment rows have no PFC of their own, so if neither side can
 * drive, a real pair is never even considered.
 *
 * WEAK, never exact. A suggestion costs one tap and leaves the money counted until confirmed;
 * auto-applying on "this row touched a brokerage" alone would hide money on an amount collision.
 */
function isInvestmentRow(item: FeedItem): boolean {
  return item.source === 'investment'
}

const INVESTMENT_WEAK_DRIVER = (item: FeedItem): Driver => ({
  item,
  strength: 'weak',
  restrict: 'account_transfer',
  requireInvestmentCounterpart: false,
})

/** Real income (dividends, interest, wages...) is never the income leg of a transfer. */
function isIncomeTagged(item: FeedItem): boolean {
  return item.pfcDetailed?.startsWith('INCOME_') ?? false
}

/**
 * Driver strength. 'exact' = Plaid named this specific movement, eligible for auto-apply.
 * 'weak' = generic transfer signal (TRANSFER_OUT_*, an untagged credit-account inflow) —
 * suggestion at best, auto-apply never.
 */
type DriverStrength = 'exact' | 'weak'

interface Driver {
  item: FeedItem
  strength: DriverStrength
  /** Which counterpart account types are admissible: see candidateKind(). */
  restrict: AutoTransferKind | null
  /**
   * When true, the driver's COUNTERPART must sit on an investment account. Set for both
   * *_INVESTMENT_AND_RETIREMENT_FUNDS codes, whose 'exact' strength is justified by Plaid naming
   * the movement AND the account type corroborating it — the code alone would also auto-apply a
   * mislabelled checking->savings move.
   *
   * Expressed as "the counterpart", not "the income leg", because the two codes drive from
   * opposite sides: a contribution drives from the checking OUTFLOW (counterpart = the income
   * leg), a withdrawal from the checking INFLOW (counterpart = the expense leg). Naming it for
   * one side is what made the withdrawal direction impossible to express.
   */
  requireInvestmentCounterpart: boolean
}

export function detectTransfers(input: AutoMatchInput): AutoMatchResult {
  const { feed, accounts, deltaIds, dismissedIds } = input
  const accountById = new Map(accounts.map((a) => [a.account_id, a]))
  const dismissed = dismissedIds ?? new Set<string>()

  // --- Eligibility -------------------------------------------------------------------
  // Candidate (index-side) eligibility deliberately does NOT require a PFC tag: Plaid
  // tags legs asymmetrically, so demanding the tag on both sides silently misses pairs.
  function isEligibleIgnoringIncomeTag(item: FeedItem): boolean {
    if (item.source === 'manual') return false // manual entries: no account, no PFC — unsafe
    if (item.pending) return false // pending ids are replaced on posting
    if (item.amount === 0) return false
    if (item.transferId !== null || item.transferKind !== null) return false // already in a transfer
    if (item.reimbursedAmount !== null || item.isReimbursementIncome) return false // reimbursement-linked
    if (dismissed.has(item.id)) return false
    const account = item.accountId ? accountById.get(item.accountId) : undefined
    if (!account) return false // can't verify account type -> can't verify anything
    // A liability-account *outflow* is a purchase or a loan disbursement, never the
    // paying side of an internal transfer we detect.
    if (item.amount > 0 && isLiabilityAccount(account)) return false
    // A brokerage-cash row whose PFC already marks it internal movement is settled: it is the fund
    // side of a sweep or a core-account redemption, and its counterpart is the holdings, not
    // another account. Pairing it can only mislabel it — and worse, because a redemption is sized
    // to the transfer it funds, it collides on amount with that transfer and competes for its leg.
    if (isInternalMovement(item)) return false
    return true
  }

  /**
   * Real income is never the income leg of an ordinary transfer, so income-tagged inflows are
   * kept out of the main index entirely — a wage deposit must not pair with an equal outflow.
   */
  function isEligible(item: FeedItem): boolean {
    if (!isEligibleIgnoringIncomeTag(item)) return false
    return !(item.amount < 0 && isIncomeTagged(item))
  }

  const eligible = feed.filter(isEligible)

  /**
   * Income-tagged inflows, indexed separately and visible ONLY to an investment driver.
   *
   * Plaid routinely tags money arriving from a brokerage as INCOME_* — an outbound ACH from
   * Fidelity lands in checking looking like income, because from the bank's side that is what it
   * resembles. The blanket rejection above therefore made the counterpart of a real withdrawal
   * invisible: not rejected during pairing, absent from the index, so nothing was ever considered.
   *
   * An investment row of the identical amount on the same day is strong evidence against the
   * INCOME_ tag — that money demonstrably left a brokerage. It is not proof, so this can only ever
   * produce a suggestion: investment rows drive weakly, and Pass 2 never auto-applies. A wage
   * deposit is untouched, because nothing but an investment driver can see this index.
   */
  const incomeTaggedInflowsByAmount = new Map<number, FeedItem[]>()
  for (const item of feed) {
    if (item.amount >= 0 || !isIncomeTagged(item)) continue
    if (!isEligibleIgnoringIncomeTag(item)) continue
    const key = centsKey(item)
    const bucket = incomeTaggedInflowsByAmount.get(key)
    if (bucket) bucket.push(item)
    else incomeTaggedInflowsByAmount.set(key, [item])
  }

  // --- Index: full cache, keyed by cents ---------------------------------------------
  const inflowsByAmount = new Map<number, FeedItem[]>()
  const outflowsByAmount = new Map<number, FeedItem[]>()
  for (const item of eligible) {
    const map = item.amount > 0 ? outflowsByAmount : inflowsByAmount
    const key = centsKey(item)
    const bucket = map.get(key)
    if (bucket) bucket.push(item)
    else map.set(key, [item])
  }

  // --- Drivers: strong-signal items, both directions, restricted to the delta ---------
  function classifyDriver(item: FeedItem): Driver | null {
    const code = item.pfcDetailed
    if (item.amount > 0) {
      if (code === CC_PAYMENT_CODE) return { item, strength: 'exact', restrict: 'credit_card_payment', requireInvestmentCounterpart: false }
      if (code === TRANSFER_OUT_EXACT) return { item, strength: 'exact', restrict: 'account_transfer', requireInvestmentCounterpart: false }
      if (code === TRANSFER_OUT_INVESTMENT) {
        return { item, strength: 'exact', restrict: 'account_transfer', requireInvestmentCounterpart: true }
      }
      // Generic TRANSFER_OUT_* (P2P, withdrawal, savings): worth surfacing, never auto.
      if (code?.startsWith('TRANSFER_OUT')) return { item, strength: 'weak', restrict: null, requireInvestmentCounterpart: false }
      if (isInvestmentRow(item)) return INVESTMENT_WEAK_DRIVER(item)
      return null
    }
    const account = accountById.get(item.accountId!)
    if (isCreditAccount(account)) {
      // A credit-account inflow is structurally a payment landing on the card. Exact only
      // when Plaid names it; this is what drives late-linked-card reconciliation.
      return {
        item,
        strength: code === CC_PAYMENT_CODE ? 'exact' : 'weak',
        restrict: 'credit_card_payment',
        requireInvestmentCounterpart: false,
      }
    }
    if (code === TRANSFER_IN_EXACT) return { item, strength: 'exact', restrict: 'account_transfer', requireInvestmentCounterpart: false }
    // The mirror of TRANSFER_OUT_INVESTMENT above: money landing in checking FROM a brokerage.
    // Without this a withdrawal could only ever be a suggestion, because the brokerage side
    // carries no PFC code and so can never drive.
    if (code === TRANSFER_IN_INVESTMENT) {
      return { item, strength: 'exact', restrict: 'account_transfer', requireInvestmentCounterpart: true }
    }
    if (code?.startsWith('TRANSFER_IN')) return { item, strength: 'weak', restrict: 'account_transfer', requireInvestmentCounterpart: false }
    if (isInvestmentRow(item)) return INVESTMENT_WEAK_DRIVER(item)
    return null
  }

  const drivers: Driver[] = []
  for (const item of eligible) {
    if (deltaIds && !deltaIds.has(item.id)) continue
    const driver = classifyDriver(item)
    if (driver) drivers.push(driver)
  }

  // --- Pairing -----------------------------------------------------------------------
  /** The kind a concrete pair would be, from the income leg's account type. */
  function pairKind(income: FeedItem): AutoTransferKind {
    return isCreditAccount(accountById.get(income.accountId!)) ? 'credit_card_payment' : 'account_transfer'
  }

  function pairAllowed(
    outflow: FeedItem,
    inflow: FeedItem,
    restrict: AutoTransferKind | null,
  ): boolean {
    if (outflow.accountId === inflow.accountId) return false
    if (daysBetween(outflow.postedDate, inflow.postedDate) > AUTO_MATCH_WINDOW_DAYS) return false
    // Income leg on a loan account is a mortgage/car payment landing — real spending on
    // the outflow side, out of scope by design.
    const incomeAccount = accountById.get(inflow.accountId!)
    if (incomeAccount && incomeAccount.type === 'loan') return false
    const kind = pairKind(inflow)
    if (restrict && kind !== restrict) return false
    return true
  }

  /**
   * All admissible counterparts for one item, given a driver's restriction.
   *
   * requireInvestmentCounterpart is checked here rather than in pairAllowed because only this
   * function knows which side is the driver: `item` drives, `candidate` is the counterpart. In
   * pairAllowed the two are already flattened to outflow/inflow, which cannot express "the other
   * one" for a driver that may sit on either side.
   */
  function candidatesFor(
    item: FeedItem,
    restrict: AutoTransferKind | null,
    requireInvestmentCounterpart: boolean,
  ): FeedItem[] {
    const opposite = item.amount > 0 ? inflowsByAmount : outflowsByAmount
    const bucket = opposite.get(centsKey(item)) ?? []
    // Only a brokerage OUTFLOW looks here: the income tag only ever sits on an inflow, and only
    // money demonstrably leaving a brokerage has the standing to overrule it.
    //
    // isBrokerageCashAccount as well as source 'investment', because the /investments product is
    // not where this actually shows up. A cash management account reports through
    // /transactions/sync as an ordinary depository account, so its outflows are plain 'plaid' rows
    // — and those are exactly the ones whose counterparts arrive at the bank tagged INCOME_*.
    const canOverruleIncomeTag = item.amount > 0 && (item.source === 'investment' || item.isBrokerageCashAccount)
    const withIncomeTagged = canOverruleIncomeTag
      ? [...bucket, ...(incomeTaggedInflowsByAmount.get(centsKey(item)) ?? [])]
      : bucket
    return withIncomeTagged.filter((candidate) => {
      if (requireInvestmentCounterpart) {
        // isBrokerageCashAccount, not isInvestmentAccount: a cash management account is Plaid
        // `depository` / `cash management`, and it is where a bank transfer tagged
        // *_INVESTMENT_AND_RETIREMENT_FUNDS most often lands. Requiring `investment` there rejected
        // the single most likely counterpart the code can have.
        const candidateAccount = candidate.accountId ? accountById.get(candidate.accountId) : undefined
        if (!candidateAccount || !isBrokerageCashAccount(candidateAccount)) return false
      }
      const outflow = item.amount > 0 ? item : candidate
      const inflow = item.amount > 0 ? candidate : item
      return !consumed.has(candidate.id) && pairAllowed(outflow, inflow, restrict)
    })
  }

  function toDraft(driver: FeedItem, candidate: FeedItem): TransferDraft {
    const expense = driver.amount > 0 ? driver : candidate
    const income = driver.amount > 0 ? candidate : driver
    return { kind: pairKind(income), expense, income, amount: Math.abs(expense.amount) }
  }

  const consumed = new Set<string>()
  const autoApply: TransferDraft[] = []
  const suggestionDrafts: TransferDraft[] = []
  const suggestedItemIds = new Set<string>()

  // At most one suggestion per feed item: competing alternatives (two possible counterparts
  // for one payment) must not surface as two rows claiming the same transaction. First
  // writer wins — exact drivers run before weak ones, and each picks its nearest candidate.
  function suggest(draft: TransferDraft) {
    if (suggestedItemIds.has(draft.expense.id) || suggestedItemIds.has(draft.income.id)) return
    suggestedItemIds.add(draft.expense.id)
    suggestedItemIds.add(draft.income.id)
    suggestionDrafts.push(draft)
  }

  /**
   * Nearest date first (then id, for determinism) — the default the user most likely means.
   *
   * Candidates already claimed by another suggestion are skipped rather than picked and then
   * rejected by suggest(). Two equal outflows out of one account rank the same inflow first, and
   * stopping at that one meant the second outflow surfaced nothing at all, even with a perfectly
   * good counterpart still free. Undefined only when every candidate is spoken for.
   */
  function nearestUnclaimed(item: FeedItem, candidates: FeedItem[]): FeedItem | undefined {
    return [...candidates]
      .filter((candidate) => !suggestedItemIds.has(candidate.id))
      .sort((a, b) => daysBetween(item.postedDate, a.postedDate) - daysBetween(item.postedDate, b.postedDate) || a.id.localeCompare(b.id))[0]
  }

  /** nearestUnclaimed + suggest, the pairing every caller below wants. */
  function suggestNearest(driver: FeedItem, candidates: FeedItem[]): void {
    const candidate = nearestUnclaimed(driver, candidates)
    if (candidate) suggest(toDraft(driver, candidate))
  }

  // Pass 1 — exact drivers, the only ones allowed to auto-apply. Auto-apply requires
  // MUTUAL uniqueness: the candidate must also have no other possible counterpart.
  // (Two $500 payments and one $500 credit inflow must never silently pick one — the
  // unidirectional check would, and which one would depend on iteration order.)
  for (const driver of drivers) {
    if (driver.strength !== 'exact') continue
    if (consumed.has(driver.item.id)) continue
    const candidates = candidatesFor(driver.item, driver.restrict, driver.requireInvestmentCounterpart)
    if (candidates.length === 0) {
      // The account type didn't corroborate an investment-restricted code (e.g. a
      // checking->savings move mistakenly tagged TRANSFER_OUT_INVESTMENT_AND_RETIREMENT_FUNDS):
      // still worth surfacing as a suggestion, just never auto-applied on the code alone.
      if (driver.requireInvestmentCounterpart) {
        // restrict: null (not driver.restrict) — this restores the pre-existing weak-driver
        // behaviour for an uncorroborated code, which never restricted the counterpart kind.
        // Passing driver.restrict here would newly reject a mistagged credit-card counterpart,
        // narrowing a suggestion the old code path used to surface.
        const unrestricted = candidatesFor(driver.item, null, false)
        if (unrestricted.length > 0) suggestNearest(driver.item, unrestricted)
      }
      continue // no counterpart yet — stays counted, re-checked next sync
    }
    if (candidates.length === 1) {
      const candidate = candidates[0]
      // false, not the driver's flag: this call asks "does the candidate have exactly one
      // possible counterpart", and the counterparts here are the driver's own side, not the
      // investment side. Widening it can only ADD candidates, which fails the ===1 test below and
      // downgrades to a suggestion — the safe direction.
      const reverse = candidatesFor(candidate, driver.restrict, false)
      // An income-tagged candidate is only visible at all because the driver sits on a brokerage,
      // and that inference is not strong enough to hide money on. Plaid may simply be right that
      // this is a paycheck. Downgrade to a suggestion; one tap settles it, and until then the
      // money stays counted.
      if (reverse.length === 1 && reverse[0].id === driver.item.id && !isIncomeTagged(candidate)) {
        const draft = toDraft(driver.item, candidate)
        autoApply.push(draft)
        consumed.add(draft.expense.id)
        consumed.add(draft.income.id)
        continue
      }
    }
    suggestNearest(driver.item, candidates)
  }

  // Pass 2 — weak drivers: suggestions only, and only from what auto-apply left behind.
  for (const driver of drivers) {
    if (driver.strength !== 'weak') continue
    if (consumed.has(driver.item.id)) continue
    const candidates = candidatesFor(driver.item, driver.restrict, driver.requireInvestmentCounterpart)
    if (candidates.length === 0) continue
    suggestNearest(driver.item, candidates)
  }

  // A suggestion whose leg was later claimed by an auto-apply is stale — drop it.
  const suggestions = suggestionDrafts.filter(
    (draft) => !consumed.has(draft.expense.id) && !consumed.has(draft.income.id),
  )

  return { autoApply, suggestions }
}

/**
 * Pairs that WILL be considered once they post: the same shape the detector above looks for,
 * but with at least one leg still pending. Without this, a transfer whose legs are both
 * visible in the feed shows nothing at all for the 1–3 days the bank takes to post them —
 * indistinguishable from detection not working.
 *
 * Pending ids are REPLACED when a transaction posts (and amounts can drift — tips, holds), so
 * nothing here may ever be persisted or confirmed. The output is ephemeral UI ("possible
 * transfer — pending"), recomputed from scratch on every pass; when the legs post, the pair
 * leaves this list and re-enters detectTransfers as a real draft.
 */
export function detectPendingPreviews(input: Omit<AutoMatchInput, 'deltaIds'>): TransferDraft[] {
  const { feed, accounts, dismissedIds } = input
  const accountById = new Map(accounts.map((a) => [a.account_id, a]))
  const dismissed = dismissedIds ?? new Set<string>()

  // Mirrors the main detector's eligibility, minus the pending exclusion that defines this pass.
  function isEligible(item: FeedItem): boolean {
    if (item.source === 'manual') return false
    if (item.amount === 0) return false
    if (item.transferId !== null || item.transferKind !== null) return false
    if (item.reimbursedAmount !== null || item.isReimbursementIncome) return false
    if (dismissed.has(item.id)) return false
    const account = item.accountId ? accountById.get(item.accountId) : undefined
    if (!account) return false
    if (item.amount > 0 && isLiabilityAccount(account)) return false
    if (item.amount < 0 && (item.pfcDetailed?.startsWith('INCOME_') ?? false)) return false
    return true
  }

  // At least a weak transfer-shaped signal on one leg, so two coincidental equal charges
  // (two $12 lunches the same week) never preview as a transfer.
  function hasTransferSignal(outflow: FeedItem, inflow: FeedItem): boolean {
    for (const item of [outflow, inflow]) {
      const code = item.pfcDetailed
      if (code === 'LOAN_PAYMENTS_CREDIT_CARD_PAYMENT' || code?.startsWith('TRANSFER_')) return true
      if (item.isBrokerageCashAccount) return true
    }
    return isCreditAccount(accountById.get(inflow.accountId!))
  }

  const eligible = feed.filter(isEligible)
  const inflowsByAmount = new Map<number, FeedItem[]>()
  for (const item of eligible) {
    if (item.amount >= 0) continue
    const key = centsKey(item)
    const bucket = inflowsByAmount.get(key)
    if (bucket) bucket.push(item)
    else inflowsByAmount.set(key, [item])
  }

  const previews: TransferDraft[] = []
  const used = new Set<string>()
  for (const outflow of eligible) {
    if (outflow.amount <= 0 || used.has(outflow.id)) continue
    const candidates = (inflowsByAmount.get(centsKey(outflow)) ?? []).filter((inflow) => {
      if (used.has(inflow.id)) return false
      // At least one pending leg — fully posted pairs belong to detectTransfers.
      if (!outflow.pending && !inflow.pending) return false
      if (outflow.accountId === inflow.accountId) return false
      if (daysBetween(outflow.postedDate, inflow.postedDate) > AUTO_MATCH_WINDOW_DAYS) return false
      if (accountById.get(inflow.accountId!)?.type === 'loan') return false
      return hasTransferSignal(outflow, inflow)
    })
    if (candidates.length === 0) continue
    const inflow = [...candidates].sort(
      (a, b) => daysBetween(outflow.postedDate, a.postedDate) - daysBetween(outflow.postedDate, b.postedDate) || a.id.localeCompare(b.id),
    )[0]
    used.add(outflow.id)
    used.add(inflow.id)
    previews.push({
      kind: isCreditAccount(accountById.get(inflow.accountId!)) ? 'credit_card_payment' : 'account_transfer',
      expense: outflow,
      income: inflow,
      amount: Math.abs(outflow.amount),
    })
  }
  return previews
}
