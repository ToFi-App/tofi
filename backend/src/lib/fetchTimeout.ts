/**
 * Bounds a single fetch call so a connection that's accepted but never answered can't hang a
 * serverless invocation indefinitely. Mirrors frontend/lib/api/fetchTimeout.ts's fix for the
 * same problem class on the outbound side: Supabase's own Postgres/PostgREST clients
 * (lib/supabase/serviceClient.ts, scopedClient.ts) have no timeout of their own, so a stalled
 * connection there is exactly the "app hanging" failure mode the frontend-facing half of this
 * work exists to catch — just reachable from the backend's outbound leg instead.
 *
 * 10s leaves headroom under an unconfigured Vercel function's default duration while still
 * being generous for an ordinary Postgres/PostgREST round trip.
 */
export const DEFAULT_FETCH_TIMEOUT_MS = 10_000

/**
 * Returns a fetch wrapper bounded to `timeoutMs`, chained to whatever `AbortSignal` the caller
 * already passed in `init.signal`. The explicit `callerSignal?.aborted` check before ever
 * calling fetch matters: a plain `addEventListener('abort', ...)` relay alone would silently
 * miss a signal already aborted at attach time, since that event never fires retroactively.
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
