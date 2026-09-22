/**
 * The app's one place for reporting a failure nobody is watching.
 *
 * Originally just the automatic paths — the background wake, auto-applied transfers, the
 * orphan sweep, a corrupt cache entry — which are caught, handled correctly, and then
 * invisible. Also now called from interactive auth failures (lib/supabase/auth.ts): a platform
 * outage on the sign-in provider needs the same off-device visibility a background failure
 * does, and "the user will complain" doesn't reliably surface that at the scale that matters —
 * a handful of complaints looks identical to isolated bad luck without an aggregate count.
 *
 * Adding the remote leg to this shared function means every EXISTING caller gets it too, not
 * just the auth-sign-in one this change was written for — including, for instance, the
 * Plaid-credentials "test connection" button's failure handler. That's a deliberate choice, not
 * an oversight: every current call site is either an automatic path already covered by the
 * reasoning above, or an interactive failure for which the same "isolated complaints vs. a real
 * pattern" argument applies just as well as it does for sign-in.
 *
 * `console.error` reaches the Metro console in development and the device log (Console.app,
 * `adb logcat`) in a release build. `reportClientError` (observability router, backend) is the
 * actual off-device destination — the same Axiom sink the backend's own errors ship to, so an
 * incident shows up in one place regardless of which side of the app noticed it first. It is
 * fire-and-forget and can never throw or block the caller: a broken reporting path must never
 * become the reason the original failure wasn't handled.
 *
 * Detail must never carry financial data. Amounts, merchant names and raw transaction bodies
 * stay out of it (architecture.md's on-device boundary); ids and counts are what make a line
 * actionable anyway — and detail never reaches the remote sink at all, only `scope` and the
 * error's own message/name, keeping that boundary structurally true rather than reviewer-enforced.
 */
// One remote report per scope per window, no matter how many times reportError fires for it.
// Some call sites are per-item inside a loop (mmkv.ts reads one cache entry per account,
// TransactionFeedProvider's orphan sweep is one call per stale transfer id) — a single corrupted
// cache affecting 200 items would otherwise mean 200 outbound requests, on a device that may
// also be offline and paying for each one in battery during background execution. The console
// line is unaffected: every call still logs locally, only the remote leg is throttled.
const REMOTE_REPORT_THROTTLE_MS = 30_000
const lastRemoteReportAt = new Map<string, number>()

// Callers that outlive their own return value (a background task whose process can be
// suspended the instant its promise settles) need to await this; everything else is free to
// call it and move on, since a rejection here is never possible — see reportRemote's own catch.
export function reportError(scope: string, error: unknown, detail?: Record<string, unknown>): Promise<void> {
  const message = error instanceof Error ? error.message : String(error)
  const parts: unknown[] = [`[${scope}] ${message}`]
  if (detail && Object.keys(detail).length > 0) parts.push(detail)
  // The Error itself last, so a console that renders stacks still has one to render.
  if (error instanceof Error) parts.push(error)
  console.error(...parts)

  const now = Date.now()
  const lastReport = lastRemoteReportAt.get(scope)
  if (lastReport !== undefined && now - lastReport < REMOTE_REPORT_THROTTLE_MS) return Promise.resolve()
  lastRemoteReportAt.set(scope, now)

  return reportRemote(scope, message, error instanceof Error ? error.name : undefined, now)
}

async function reportRemote(scope: string, message: string, name: string | undefined, reportedAt: number): Promise<void> {
  try {
    const { createHeadlessApiClient } = await import('@/lib/api/client')
    await createHeadlessApiClient().observability.reportClientError.mutate({ scope, message, name })
  } catch {
    // The sink itself is down, or the device is offline — already on the console above, and
    // there is nowhere further to escalate to. But the throttle timestamp above was set
    // optimistically, before this attempt even started, so a failed send must not count as one:
    // undoing it means the NEXT real failure for this scope can try again immediately, rather
    // than every occurrence in the next 30s being silently dropped with zero delivery attempts.
    // Only undo it if it's still THIS call's timestamp: a slow failure can resolve after a
    // later, un-throttled call for the same scope already wrote its own fresher timestamp, and
    // that later call's own in-flight attempt must not be un-throttled out from under it.
    if (lastRemoteReportAt.get(scope) === reportedAt) lastRemoteReportAt.delete(scope)
  }
}
