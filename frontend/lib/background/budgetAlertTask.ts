import * as BackgroundTask from 'expo-background-task'
import * as TaskManager from 'expo-task-manager'
import { createHeadlessApiClient } from '@/lib/api/client'
import { supabaseAuth } from '@/lib/supabase/auth'
import { getCachedInvestmentTransactions, getCachedTransactions } from '@/lib/storage/mmkv'
import { syncDriver } from '@/lib/transactions/syncDriver'
import { reportError } from '@/lib/observability/log'
import { applyTransfers, mergeFeed } from '@/lib/transactions/resolveFeed'
import { applySweepExclusion } from '@/lib/transactions/sweepExclusion'
import { deliverBudgetAlerts } from '@/lib/budgets/deliverAlerts'
import { ensureNotificationPermission } from '@/lib/notifications/permission'
import { getBudgetAlertsEnabled } from '@/lib/notifications/preference'
import { resolveBudgetsForMonth } from '@/lib/budgets/budgetMath'

export const BUDGET_ALERT_TASK = 'budget-alert-sync'

// Background wakes are short (~30s) and infrequent; a fresh install's history backlog is the
// foreground's job. Four rounds cover any realistic day's delta, and at 10 pages each they stay
// inside Plaid's 50-calls-per-minute-per-item budget without the driver's pacing — which is why
// this caller runs unpaced (see the syncNow options below).
const MAX_BACKGROUND_DRAIN_ROUNDS = 4

/**
 * The app-closed half of budget alerting: iOS wakes the app in the background, this syncs new
 * transactions from Plaid into the same MMKV cache the app reads, resolves the feed with the
 * same pure pipeline the foreground uses, and delivers any newly crossed alert lines as local
 * notifications. Transactions still never leave the device — the "server" here is our own
 * backend proxying Plaid, exactly as when the app is open.
 *
 * Everything is best-effort: any failure returns Failed and the next wake retries. The MMKV
 * fired-marks shared with the foreground watcher guarantee a crossing is announced only once
 * no matter which side sees it first.
 */
export async function runBudgetAlertCheck(): Promise<'delivered' | 'no-alerts' | 'skipped'> {
  const { data } = await supabaseAuth.auth.getSession()
  if (!data.session) return 'skipped'

  // Both gates that can make the whole wake pointless, checked before the sync rather than at
  // delivery time inside deliverBudgetAlerts. Background seconds are rationed by the OS, and
  // syncing to compute a notification we are switched off from sending — or have no permission
  // to post — spends them on nothing. The cost is that the MMKV cache no longer warms in the
  // background for a user with alerts off; the next app open syncs as it always has.
  if (!getBudgetAlertsEnabled()) return 'skipped'
  if (!(await ensureNotificationPermission({ canPrompt: false }))) return 'skipped'

  const client = createHeadlessApiClient()

  // Budgets first: with no alert line armed this month there is nothing a sync could surface,
  // so skip the heavy work entirely — background seconds are rationed by the OS.
  const budgets = await client.budgets.list.query()
  const today = new Date()
  const resolved = resolveBudgetsForMonth(budgets, { year: today.getFullYear(), month: today.getMonth() + 1 })
  if (![...resolved.values()].some((b) => b.alertThreshold != null)) return 'skipped'

  const [accountsResult, categories, manualTransactions, overrides, vendorMappings, plaidCategoryMappings, transfers] =
    await Promise.all([
      client.accounts.list.query(),
      client.categories.list.query(),
      client.manualTransactions.list.query(),
      client.transactionOverrides.list.query(),
      client.vendorMappings.list.query(),
      client.plaidCategoryMappings.list.query(),
      client.transfers.list.query(),
    ])

  const accounts = accountsResult.accounts
  const itemIds = Array.from(new Set(accounts.map((a) => a.itemId)))
  if (itemIds.length === 0) return 'skipped'
  const accountIdToItemId = new Map(accounts.map((a) => [a.account_id, a.itemId]))

  // The same driver the app uses, so a background wake can never fold a sync response
  // differently than the foreground would have. Removals it queues are picked up by the
  // foreground orphan sweep on the next app open — this task only ever reads transfers.
  //
  // force: a wake must not be suppressed by a cooldown the foreground set before backgrounding.
  // minRoundIntervalMs 0: iOS grants ~30s, and the driver's 15s pacing would spend the whole
  // window asleep; the round cap above keeps us inside the rate limit instead.
  // stopOnRateLimit: a rate-limit backoff starts at 30s, which this wake cannot outlive — so
  // stop and let the next wake resume from the persisted cursors.
  await syncDriver.syncNow({
    itemIds,
    accountIdToItemId,
    call: (input) => client.transactions.sync.mutate(input),
    force: true,
    maxRounds: MAX_BACKGROUND_DRAIN_ROUNDS,
    minRoundIntervalMs: 0,
    stopOnRateLimit: true,
  })

  // Investment rows come from the MMKV cache rather than a fresh window fetch: they only affect
  // brokerage-cash classification (sweep exclusion), and the foreground refreshes them on open.
  const rawTransactions = itemIds.flatMap((itemId) => getCachedTransactions(itemId))
  const investmentTransactions = itemIds.flatMap((itemId) => getCachedInvestmentTransactions(itemId))
  const merged = mergeFeed(
    rawTransactions,
    manualTransactions,
    overrides,
    vendorMappings,
    plaidCategoryMappings,
    accounts,
    investmentTransactions,
  )
  const feed = applySweepExclusion(applyTransfers(merged, transfers))

  const delivered = await deliverBudgetAlerts({ feed, budgets, categories, canPrompt: false })
  return delivered > 0 ? 'delivered' : 'no-alerts'
}

TaskManager.defineTask(BUDGET_ALERT_TASK, async () => {
  try {
    await runBudgetAlertCheck()
    return BackgroundTask.BackgroundTaskResult.Success
  } catch (err) {
    // Transient by assumption (network, expired wake window); the next wake retries with the
    // same cursors, and planSyncMerge's idempotency makes a half-applied round harmless. But
    // the assumption is what needs checking: unreported, a permanently broken background wake
    // is indistinguishable from one that has nothing to say, in either case forever. Awaited,
    // not fire-and-forget: the OS can suspend this process the instant this callback's promise
    // settles, and an un-awaited report has no guaranteed window left to actually send.
    await reportError('budget-alert-task', err)
    return BackgroundTask.BackgroundTaskResult.Failed
  }
})

/**
 * Idempotent; called once from the root layout. The interval is in minutes, and iOS treats it
 * as a floor, not a schedule — real cadence is decided by the system (typically a few wakes a
 * day for an app that gets opened regularly), so asking for an hour buys eligibility for more
 * frequent wakes rather than an hourly guarantee.
 */
export async function registerBudgetAlertTask(): Promise<void> {
  try {
    await BackgroundTask.registerTaskAsync(BUDGET_ALERT_TASK, { minimumInterval: 60 })
  } catch (err) {
    // Unavailable on this platform/build (e.g. web, or Background App Refresh disabled) —
    // the foreground watcher still covers every app open.
    reportError('budget-alert-task-registration', err)
  }
}
