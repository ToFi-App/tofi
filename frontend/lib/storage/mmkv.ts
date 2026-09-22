import { MMKV } from 'react-native-mmkv'
import { reportError } from '@/lib/observability/log'
import type { InvestmentTransaction, PlaidTransaction } from '@/types/domain'

const storage = new MMKV({ id: 'ledge-transaction-cache' })

function transactionsKey(itemId: string): string {
  return `transactions:${itemId}`
}

function cursorKey(itemId: string): string {
  return `cursor:${itemId}`
}

export function getCachedTransactions(itemId: string): PlaidTransaction[] {
  const raw = storage.getString(transactionsKey(itemId))
  if (!raw) return []
  try {
    return JSON.parse(raw) as PlaidTransaction[]
  } catch (err) {
    // A corrupted cache entry must not crash the feed — treat it as empty and let the
    // next sync rebuild it from Plaid. Reported because the recovery is indistinguishable from
    // an empty cache: silently, this became a full re-drain of the item's history from Plaid.
    // The payload itself is never logged; it is transaction bodies.
    reportError('transaction-cache', err, { itemId })
    return []
  }
}

export function setCachedTransactions(itemId: string, transactions: PlaidTransaction[]): void {
  storage.set(transactionsKey(itemId), JSON.stringify(transactions))
}

export function getCursor(itemId: string): string | undefined {
  return storage.getString(cursorKey(itemId))
}

export function setCursor(itemId: string, cursor: string): void {
  storage.set(cursorKey(itemId), cursor)
}

/**
 * Drops an item's cached transactions and its sync cursor together.
 *
 * The pairing is the point. A disconnected institution's transactions leave the feed, but Plaid
 * keeps advancing nothing on its side — the cursor still marks everything it has already
 * reported. Reconnecting with that cursor intact would resume past the discarded history and
 * never re-deliver it, leaving a permanent hole. Clearing both makes reconnecting a full
 * re-drain instead.
 */
export function clearItemCache(itemId: string): void {
  storage.delete(transactionsKey(itemId))
  storage.delete(cursorKey(itemId))
}

// Plaid `removed` transaction ids not yet checked against the transfers table (orphan
// cleanup, docs/credit-card-payment-auto-transfer.md phase 6). Durable on purpose: a
// removal is emitted exactly once by transactionsSync, and once the merge drops the
// transaction from the cache its absence is indistinguishable from "outside the history
// window" — so losing this queue (e.g. app killed before the sweep ran) would leave a
// transfer referencing a retracted leg forever, silently hiding the surviving leg's spend.
const PENDING_REMOVED_KEY = 'pending-removed-transaction-ids'
const PENDING_REMOVED_CAP = 500

export function getPendingRemovedTransactionIds(): string[] {
  const raw = storage.getString(PENDING_REMOVED_KEY)
  if (!raw) return []
  try {
    return JSON.parse(raw) as string[]
  } catch (err) {
    reportError('pending-removed-queue', err)
    return []
  }
}

export function setPendingRemovedTransactionIds(ids: string[]): void {
  storage.set(PENDING_REMOVED_KEY, JSON.stringify(ids.slice(-PENDING_REMOVED_CAP)))
}

export function appendPendingRemovedTransactionIds(ids: string[]): void {
  if (ids.length === 0) return
  const merged = new Set(getPendingRemovedTransactionIds())
  for (const id of ids) merged.add(id)
  setPendingRemovedTransactionIds(Array.from(merged))
}

/**
 * Namespace for the investment cache, versioned.
 *
 * The backend filters `/investments/transactions/get` down to cash transfers, but that filter
 * governs new fetches only, and the merge is additive on purpose — cached rows outside the
 * incoming window survive, which is what makes a 30-day fetch safe against a 24-month cache. So
 * anything a previous filter admitted stays on disk and is replayed forever: visible in the feed
 * and the account sheet, and offered to the matcher as a pairing candidate.
 *
 * **Bump this version whenever the backend filter changes what it admits** — looser as well as
 * stricter. That is what makes the filter retroactive. Stricter needs it because rows a previous
 * filter admitted are already on disk; looser needs it because the backfilled-through markers
 * live under this same prefix, so dropping them is what makes the next launch re-request the full
 * 24 months instead of the 30-day overlap. Without the bump, a loosened filter only ever admits
 * rows inside that rolling window and everything older stays permanently unreachable.
 *
 * v1 (`investment-txns`) ingested full activity, trades included.
 * v2 (`investment-transfers`) filtered by subtype, but let security-linked corporate actions
 *    through — Plaid types a distribution or spinoff as `cash`/`deposit`.
 * v3 also requires `security_id` to be absent.
 * v4 stopped requiring `type: 'cash'` and excludes share transfers by quantity instead, which
 *    admits the external funding institutions report as `transfer`/`transfer` (Robinhood) rather
 *    than `cash`/`transfer` (Fidelity).
 */
const INVESTMENT_KEY_PREFIX = 'investment-transfers-v4'

/** Every investment cache key shares this stem, which is what makes the purge below exhaustive. */
const INVESTMENT_KEY_STEM = 'investment-'

function investmentTransactionsKey(itemId: string): string {
  return `${INVESTMENT_KEY_PREFIX}:${itemId}`
}

/**
 * The end date of the last SUCCESSFUL fetch for this item. Advanced only on success, so a
 * failed fetch leaves the window unchanged and the next sync re-covers the same range.
 */
function investmentBackfilledThroughKey(itemId: string): string {
  return `${INVESTMENT_KEY_PREFIX}-backfilled-through:${itemId}`
}

/**
 * Drops every investment cache entry outside the current version. Runs once per app start; after
 * the first run nothing matches and it is a single getAllKeys scan.
 *
 * Written as "anything in the investment namespace that is not the current version" rather than a
 * list of old prefixes, so bumping INVESTMENT_KEY_PREFIX is the only edit a stricter filter needs
 * — a list would have to be remembered and appended to, and forgetting is exactly how the last
 * two rounds of stale rows survived.
 *
 * Deleting rather than migrating in place: older entries carry different row shapes, and a stale
 * row that happens to be a genuine transfer is indistinguishable from one written under the
 * current filter. Re-fetching is cheap and exact.
 */
function purgeStaleInvestmentCache(): void {
  for (const key of storage.getAllKeys()) {
    if (key.startsWith(INVESTMENT_KEY_STEM) && !key.startsWith(INVESTMENT_KEY_PREFIX)) storage.delete(key)
  }
}

purgeStaleInvestmentCache()

export function getCachedInvestmentTransactions(itemId: string): InvestmentTransaction[] {
  const raw = storage.getString(investmentTransactionsKey(itemId))
  if (!raw) return []
  try {
    return JSON.parse(raw) as InvestmentTransaction[]
  } catch (err) {
    // Same contract as getCachedTransactions: a corrupted entry must not crash the feed.
    reportError('investment-cache', err, { itemId })
    return []
  }
}

export function setCachedInvestmentTransactions(itemId: string, transactions: InvestmentTransaction[]): void {
  storage.set(investmentTransactionsKey(itemId), JSON.stringify(transactions))
}

export function getInvestmentBackfilledThrough(itemId: string): string | undefined {
  return storage.getString(investmentBackfilledThroughKey(itemId))
}

export function setInvestmentBackfilledThrough(itemId: string, date: string): void {
  storage.set(investmentBackfilledThroughKey(itemId), date)
}

/**
 * Consecutive failed investment-transaction fetches for this item since its last success.
 * Feeds `selectFetchWindow` (lib/investments/window.ts), which stops demanding a full 24-month
 * window from an item that never backfills (e.g. no investments product) once this crosses
 * MAX_FAILED_ATTEMPTS_BEFORE_NARROWING. Reset to 0 on any success. A relinked institution gets
 * a new itemId, so a stale counter for a dead itemId is simply orphaned, never misapplied.
 */
function investmentFailedAttemptsKey(itemId: string): string {
  return `${INVESTMENT_KEY_PREFIX}-failed-attempts:${itemId}`
}

export function getInvestmentFailedAttempts(itemId: string): number {
  return storage.getNumber(investmentFailedAttemptsKey(itemId)) ?? 0
}

export function setInvestmentFailedAttempts(itemId: string, count: number): void {
  storage.set(investmentFailedAttemptsKey(itemId), count)
}

/**
 * Drops every cached transaction, investment transaction, cursor and pending removal for this
 * device.
 *
 * Every key in here is scoped by Plaid item id, never by user, so nothing in the cache can
 * be reconciled against a new session — clearing the instance wholesale is the only correct
 * response to a user change. Signing out and back in previously left `transactions:<itemId>`
 * in place and, worse, left `cursor:<itemId>` in place too, so the next sync asked Plaid
 * only for the delta and the stale bodies could never be rebuilt.
 *
 * This includes the pending-removal queue, whose durability comment above is about
 * surviving an app kill *within* a session. Across a user change it is actively unsafe: the
 * ids are global, not per-user, and they drive `transfers.delete` against whoever signs in
 * next.
 *
 * The cost is that the following sync restarts each item from cursor '' and re-downloads
 * full history. Correctness over bandwidth — moving cursors server-side would recover it.
 */
export function clearTransactionCache(): void {
  storage.clearAll()
}
