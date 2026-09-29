/**
 * Bounds a single fetch call so a connection that's accepted but never answered — a stalled
 * proxy, a captive portal, a wedged server — can't hang forever. Without this, `await fetch(...)`
 * blocks indefinitely and nothing downstream (a retry loop, a UI loading state) ever gets the
 * chance to react. 20s comfortably exceeds Vercel's default function duration, so a request
 * genuinely still being processed on a healthy connection is never cut off before the server
 * itself would have answered or timed out.
 *
 * A standalone module, not part of lib/api/client.ts: that file imports `supabaseAuth` from
 * lib/supabase/auth.ts, and auth.ts needs this same bound on its own client's fetch (its token
 * refresh call is exactly the kind of unbounded network call this exists to prevent) — importing
 * from client.ts there would be a real circular dependency, not the deliberately-deferred one
 * reportError already uses.
 */
export const DEFAULT_FETCH_TIMEOUT_MS = 20_000

/**
 * Returns a fetch wrapper bounded to `timeoutMs`, chained to whatever `AbortSignal` the caller
 * already passed in `init.signal` — an explicit cancellation still works exactly as it would
 * with a bare fetch. Chaining is done manually (recreating a controller and relaying the abort
 * event) rather than the caller's signal being passed straight through, so the timeout can fire
 * independently; the check for a signal that's ALREADY aborted at call time matters here; a
 * plain `addEventListener('abort', ...)` relay would silently miss it, since that event never
 * fires retroactively for a signal already in the aborted state.
 */
export function fetchWithTimeout(timeoutMs: number = DEFAULT_FETCH_TIMEOUT_MS): typeof fetch {
  return async (input, init) => {
    const callerSignal = init?.signal
    const controller = new AbortController()
    if (callerSignal?.aborted) controller.abort()
    const onCallerAbort = () => controller.abort()
    callerSignal?.addEventListener('abort', onCallerAbort)
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs)
    try {
      return await fetch(input, { ...init, signal: controller.signal })
    } finally {
      clearTimeout(timeoutId)
      callerSignal?.removeEventListener('abort', onCallerAbort)
    }
  }
}
