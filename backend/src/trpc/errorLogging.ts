import { plaidErrorOf } from '../lib/plaid/errors.js'
import { networkErrorOf } from '../lib/network/errors.js'
import { axiomEnvelope } from '../lib/observability/axiom.js'

/**
 * Codes that mean "the client asked for something it can't have" rather than "we broke".
 * A signed-out app polling, a validation rejection or a stale id is ordinary traffic; logging
 * those at error level is how an error log becomes noise nobody reads.
 */
/**
 * Codes reported at warn rather than error. Everything is shipped to the sink either way — this
 * only sets `level`, which is what a query filters on to separate real failures from ordinary
 * rejected traffic.
 */
const EXPECTED_CODES = new Set([
  'UNAUTHORIZED',
  'FORBIDDEN',
  'NOT_FOUND',
  'BAD_REQUEST',
  'PRECONDITION_FAILED',
  'CONFLICT',
  'TOO_MANY_REQUESTS',
])

/** What the client is told in place of an internal error's real message. */
export const REDACTED_MESSAGE = 'Something went wrong. Please try again.'

interface LoggerLike {
  warn(detail: object, message: string): void
  error(detail: object, message: string): void
}

interface TrpcErrorLike {
  code: string
  message: string
  cause?: unknown
}

export interface TrpcErrorEvent {
  error: TrpcErrorLike
  path?: string
  type: string
  /** Accepted so callers can pass tRPC's event straight through — deliberately never logged. */
  input?: unknown
  userId?: string | null
}

/**
 * The backend's only error log line.
 *
 * Without it a failed procedure left no trace at all: tRPC handles its own errors, so they never
 * reach Fastify's error handler, and the access log records nothing but a status code. Worse,
 * a batch containing a failure returns HTTP 207 — so even the status code looked like a success,
 * and since every client request is batched that was effectively all of them.
 *
 * The input is accepted but never logged. Log lines are persistence, and inputs carry cursors,
 * amounts and transaction ids that must not be stored server-side (architecture.md constraint
 * 11). The user id is kept: an opaque uuid is what makes a user's report traceable to a line
 * here, and it is not financial data.
 */
/**
 * The shared description of a failure, so the stdout line and the event shipped to Axiom can
 * never disagree about what happened.
 */
function describeTrpcError(event: TrpcErrorEvent) {
  const { error, path, type, userId } = event
  // A Plaid failure's message is only ever "Request failed with status code 400"; the code that
  // says what to actually do about it is in the response body hanging off the cause.
  const plaid = plaidErrorOf(error.cause)
  // A connectivity failure to ANY downstream (Supabase, Plaid, or otherwise) — a platform
  // outage, not a bad query — would otherwise log as a bare INTERNAL_SERVER_ERROR
  // indistinguishable from an actual defect. Deliberately not attributed to a specific service:
  // see lib/network/errors.ts for why a generic network error can't honestly be pinned on one.
  const network = networkErrorOf(error.cause)
  return {
    // Checked first: an UNAUTHORIZED caused by a stalled JWKS fetch (see trpc.ts's
    // protectedProcedure) is not the routine, expected-traffic UNAUTHORIZED the warn bucket
    // exists for — it means auth verification itself is down, which is worth error-level
    // attention regardless of which TRPCError code the failure happened to surface as.
    level: !network.matched && EXPECTED_CODES.has(error.code) ? ('warn' as const) : ('error' as const),
    trpc: { path: path ?? '<unknown>', type, code: error.code },
    ...(plaid.errorType || plaid.errorCode ? { plaid } : {}),
    ...(network.matched ? { dependency: 'network', dependencyReason: network.reason } : {}),
    ...(userId ? { userId } : {}),
  }
}

export function logTrpcError(log: LoggerLike, event: TrpcErrorEvent): void {
  const { level, ...detail } = describeTrpcError(event)
  // `err` is pino's conventional key for a serialized Error — message, type and stack.
  const line = { ...detail, err: event.error }

  if (level === 'warn') {
    log.warn(line, 'trpc request rejected')
    return
  }
  log.error(line, 'trpc procedure failed')
}

/**
 * The same failure as a plain object safe to JSON.stringify.
 *
 * An Error serializes to `{}`, so shipping one verbatim would drop the message and stack — the
 * exact information this whole change exists to preserve.
 */
export function toAxiomEvent(event: TrpcErrorEvent, context: { requestId?: string }): object {
  const { level, ...detail } = describeTrpcError(event)
  const error = event.error as { name?: string; message?: string; stack?: string }
  return {
    ...axiomEnvelope(),
    level,
    service: 'tofi-backend',
    ...(context.requestId ? { requestId: context.requestId } : {}),
    ...detail,
    err: { type: error?.name ?? 'Error', message: error?.message, stack: error?.stack },
  }
}

/**
 * Keeps an internal error's message out of the response body.
 *
 * tRPC omits the stack outside development but still ships the raw message, which for an
 * unhandled throw is whatever the failure said — a database host and port, a Postgres constraint
 * name, a Plaid internal. Redacting unconditionally rather than only in production: the message
 * is now in the server log either way, so there is no environment where reading it off the wire
 * is the right habit.
 *
 * Every message the app deliberately shows a user is thrown as a typed TRPCError, which is
 * exactly what makes it survive this.
 */
export function redactInternalMessage<T extends { message: string }>(shape: T, code: string): T {
  if (code !== 'INTERNAL_SERVER_ERROR') return shape
  return { ...shape, message: REDACTED_MESSAGE }
}
