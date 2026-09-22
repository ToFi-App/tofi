/**
 * Recognizes a connectivity-shaped failure — a call that never really completed (a dropped
 * connection, a timeout, DNS failure) rather than one that completed and got an application-level
 * error back (a bad query, an RLS violation, a constraint conflict, Postgres's own statement
 * timeout). The latter are still our own bugs to log as such.
 *
 * Deliberately NOT attributed to a specific downstream service. The direct `postgres` driver
 * (backend/src/lib/db/client.ts) and PostgREST (getScopedClient) can both throw a bare Node
 * network error code (ECONNREFUSED, ETIMEDOUT, ...) on a dropped connection, and so — in
 * principle — could any other outbound call this backend makes. A generic network error code or
 * message carries no signal about *which* call failed, only that one did; claiming it was
 * specifically Supabase would be a guess dressed up as a fact, and a wrong guess here sends an
 * on-call to the wrong dashboard. Tag it as what it verifiably is: a network-layer failure.
 *
 * The message list is intentionally narrow. Two broader patterns were tried and rejected:
 * a bare `/network/i` substring matches arbitrary unrelated text, and a generic
 * timeout pattern matched Postgres's own "canceling statement due to statement timeout"
 * (SQLSTATE 57014) — a slow query of ours, not a connectivity failure. `ETIMEDOUT` (the Node
 * error code for a connection that never completed) already covers the connectivity case
 * precisely; matching the word "timeout" in arbitrary error text does not.
 *
 * Message text is the least stable signal here — undici's own "fetch failed" wording could
 * change in a future Node release with no compile-time warning. Where possible it's worth
 * checking underneath: undici wraps the real system error in `.cause`, which often still
 * carries one of the stable codes above even when the top-level error is a bare "fetch failed".
 *
 * `ERR_JWKS_TIMEOUT` is `jose`'s own error code (requireAuth.ts's `createRemoteJWKSet`) for a
 * stalled fetch of Supabase's JWKS endpoint — a real network failure hiding behind what
 * `protectedProcedure` otherwise reports as a routine UNAUTHORIZED (see trpc.ts). `ECONNABORTED`
 * is axios's own code for the Plaid client's request timeout (lib/plaid/client.ts).
 *
 * lib/fetchTimeout.ts's own abort (used by the Supabase clients in lib/supabase/) doesn't
 * surface as a code at all: postgrest-js catches it and re-wraps it as a plain object with
 * `code: ''` and a message starting "AbortError: ..." — matched below by name/message instead.
 */
const NETWORK_ERROR_CODES = new Set([
  'ECONNREFUSED',
  'ETIMEDOUT',
  'ENOTFOUND',
  'ECONNRESET',
  'EAI_AGAIN',
  'EPIPE',
  'ERR_JWKS_TIMEOUT',
  'ECONNABORTED',
])

// @supabase/auth-js wraps any failed/aborted fetch (its admin API, token refresh, sign-in) in
// this class regardless of what actually failed underneath — a stable name, not a message.
const NETWORK_ERROR_NAMES = new Set(['AuthRetryableFetchError'])

const NETWORK_MESSAGE_PATTERNS = [
  /fetch failed/i,
  /network connection was lost/i,
  /socket hang up/i,
  /other side closed/i,
  // postgrest-js's own re-wrap of an aborted/timed-out request (lib/fetchTimeout.ts firing on a
  // Supabase client) — the underlying AbortError's name folded into the message, not a field.
  /^AbortError:/i,
]

export interface NetworkErrorDetail {
  matched: boolean
  /** The code or message fragment that matched — kept for the log line, not for branching on. */
  reason?: string
}

export function networkErrorOf(err: unknown): NetworkErrorDetail {
  // Checked before the message patterns below: a code — ours or the one undici hangs off
  // `.cause` for its own "fetch failed" wrapper — is stable across runtime wording changes in
  // a way no error message is.
  const code = (err as { code?: string })?.code ?? (err as { cause?: { code?: string } })?.cause?.code
  if (code && NETWORK_ERROR_CODES.has(code)) return { matched: true, reason: code }

  const name = (err as { name?: string })?.name
  if (name && NETWORK_ERROR_NAMES.has(name)) return { matched: true, reason: name }

  const message = err instanceof Error ? err.message : typeof (err as { message?: unknown })?.message === 'string' ? (err as { message: string }).message : undefined
  if (message && NETWORK_MESSAGE_PATTERNS.some((pattern) => pattern.test(message))) {
    return { matched: true, reason: message }
  }

  return { matched: false }
}
