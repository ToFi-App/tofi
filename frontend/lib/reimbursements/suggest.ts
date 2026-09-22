import type { FeedItem } from '@/lib/transactions/resolveFeed'

/**
 * Ranks reimbursement counterparts instead of listing the whole feed. A reimbursement is a
 * payback of some fraction of an expense, so candidates are scored on how plausible that
 * fraction is (exact repayment and common splits score highest) blended with how soon after
 * the expense the money arrived. Suggestions are a shortlist — search (below) runs over the
 * looser pool so an unusual-but-real counterpart is never unreachable.
 *
 * Everything here is a tuning knob, not a law of nature — nudge freely.
 */

/**
 * Payback fractions people actually produce: full repayment and even splits of a shared cost.
 * Weighted so exact repayment always outranks a split, and big splits outrank small ones —
 * without weights every anchor peaks at the same height and a $50-of-$100 ties a $100-of-$100.
 */
const SPLIT_ANCHORS = [
  { ratio: 1, weight: 1 },
  { ratio: 3 / 4, weight: 0.92 },
  { ratio: 2 / 3, weight: 0.92 },
  { ratio: 1 / 2, weight: 0.92 },
  { ratio: 1 / 3, weight: 0.8 },
  { ratio: 1 / 4, weight: 0.8 },
]
/** Width of each anchor's score peak, as a fraction of the expense. */
const ANCHOR_SIGMA = 0.06
/** Off-anchor fractions still rank by size, so an odd $73-of-$100 beats an odd $8-of-$100. */
const RATIO_FLOOR_WEIGHT = 0.7
/** A payback may exceed the expense only by rounding slop, never materially. */
const OVERPAY_TOLERANCE = 1.02
/** Money can land slightly before the expense posts (pending lag, prepaid Venmo requests). */
const GRACE_DAYS_BEFORE = 3
/** Beyond this the pair is search territory, not a suggestion. */
const WINDOW_DAYS = 90
/** Time affinity decay constant — at 21 days apart the recency term is down to ~1/e. */
const TIME_DECAY_DAYS = 21
const AMOUNT_WEIGHT = 0.65
const TIME_WEIGHT = 0.35
/** Most paybacks arrive over P2P rails; a matching income gets a nudge, never a veto. */
const P2P_BONUS = 0.1
const P2P_PATTERN = /venmo|zelle|paypal|cash\s?app/i
/** Suggestions below this are noise — show fewer rather than pad the list. */
const SCORE_CUTOFF = 0.25
export const SUGGESTION_LIMIT = 8
export const SEARCH_LIMIT = 50

const MS_PER_DAY = 24 * 60 * 60 * 1000

/** Signed whole days from `from` to `to` (YYYY-MM-DD), positive when `to` is later. */
function signedDays(from: string, to: string): number {
  return (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / MS_PER_DAY
}

interface ExpenseLeg {
  /** The un-reimbursed remainder of the expense, positive dollars. */
  amount: number
  date: string
}

interface IncomeLeg {
  /** Absolute dollars that came back. */
  amount: number
  date: string
  merchantName?: string | null
}

/**
 * Plausibility of `income` paying back (part of) `expense`, in [0, ~1.1], or null when the
 * pair is outside suggestion territory entirely (overpayment, wrong order, too far apart).
 */
export function scoreReimbursement(expense: ExpenseLeg, income: IncomeLeg): number | null {
  if (expense.amount <= 0) return null

  const ratio = income.amount / expense.amount
  if (ratio > OVERPAY_TOLERANCE) return null

  const days = signedDays(expense.date, income.date)
  if (days < -GRACE_DAYS_BEFORE || days > WINDOW_DAYS) return null

  let amountAffinity = RATIO_FLOOR_WEIGHT * ratio
  for (const anchor of SPLIT_ANCHORS) {
    amountAffinity = Math.max(amountAffinity, anchor.weight * Math.exp(-(((ratio - anchor.ratio) / ANCHOR_SIGMA) ** 2)))
  }
  // Exact to the cent is the strongest possible signal; don't let the kernel round it down.
  if (Math.abs(income.amount - expense.amount) < 0.01) amountAffinity = 1

  const timeAffinity = Math.exp(-Math.max(days, 0) / TIME_DECAY_DAYS)
  const p2pBonus = income.merchantName && P2P_PATTERN.test(income.merchantName) ? P2P_BONUS : 0

  // Geometric blend, not additive: a plausible amount and a plausible date must BOTH hold.
  // Additively, same-day recency alone (0.35) cleared the cutoff and every tiny same-day
  // income became a "suggestion" regardless of amount.
  return amountAffinity ** AMOUNT_WEIGHT * timeAffinity ** TIME_WEIGHT + p2pBonus
}

/** The un-reimbursed remainder of an expense feed item, in positive dollars. */
export function remainingExpense(expense: FeedItem): number {
  return Math.max(0, Math.abs(expense.amount) - (expense.reimbursedAmount ?? 0))
}

export interface ScoredCandidate {
  item: FeedItem
  score: number
}

/**
 * Top counterpart suggestions for marking `item` as a reimbursement, best first. Works from
 * either side: an expense scores income candidates against its remaining amount (pass
 * `remainingOverride` to re-rank live as the user links incomes), an income scores expense
 * candidates against each expense's own remainder.
 */
export function suggestReimbursements(
  item: FeedItem,
  candidates: FeedItem[],
  options?: { remainingOverride?: number; limit?: number },
): ScoredCandidate[] {
  const limit = options?.limit ?? SUGGESTION_LIMIT
  const startingFromExpense = item.amount > 0

  const scored: ScoredCandidate[] = []
  for (const candidate of candidates) {
    const score = startingFromExpense
      ? scoreReimbursement(
          { amount: options?.remainingOverride ?? remainingExpense(item), date: item.postedDate },
          { amount: Math.abs(candidate.amount), date: candidate.postedDate, merchantName: candidate.merchantName },
        )
      : scoreReimbursement(
          { amount: remainingExpense(candidate), date: candidate.postedDate },
          { amount: Math.abs(item.amount), date: item.postedDate, merchantName: item.merchantName },
        )
    if (score !== null && score >= SCORE_CUTOFF) scored.push({ item: candidate, score })
  }

  return scored.sort((a, b) => b.score - a.score).slice(0, limit)
}

/** "$20", "20", "20.50", "20,50" → dollars; anything else → null (treat as a text query). */
export function parseAmountQuery(query: string): number | null {
  const trimmed = query.trim()
  if (!/^\$?\d+([.,]\d{1,2})?$/.test(trimmed)) return null
  return Number(trimmed.replace('$', '').replace(',', '.'))
}

/**
 * The search escape hatch: filters the full candidate pool, ignoring the suggestion gates, so
 * a payback four months late or a deliberate overpayment stays reachable. A money-looking
 * query matches amounts (near it, or whose dollars start with the typed digits); anything
 * else matches merchant names. Amount results are ordered nearest-first, text results
 * newest-first.
 */
export function searchReimbursementCandidates(query: string, pool: FeedItem[], limit = SEARCH_LIMIT): FeedItem[] {
  const trimmed = query.trim()
  if (!trimmed) return []

  const amount = parseAmountQuery(trimmed)
  if (amount !== null) {
    const digits = trimmed.replace('$', '')
    const hasCents = /[.,]/.test(digits)
    return pool
      .filter((item) => {
        const abs = Math.abs(item.amount)
        if (Math.abs(abs - amount) <= 0.5) return true
        // Prefix match on whole dollars ("20" finds $20.45 and $204) only makes sense while
        // the user is still typing an integer; a query with cents means they meant it exactly.
        return !hasCents && String(Math.trunc(abs)).startsWith(digits)
      })
      .sort((a, b) => Math.abs(Math.abs(a.amount) - amount) - Math.abs(Math.abs(b.amount) - amount))
      .slice(0, limit)
  }

  const needle = trimmed.toLowerCase()
  return pool
    .filter((item) => item.merchantName.toLowerCase().includes(needle))
    .sort((a, b) => (a.date < b.date ? 1 : -1))
    .slice(0, limit)
}
