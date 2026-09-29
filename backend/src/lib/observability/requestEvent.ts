import { axiomEnvelope } from './axiom.js'

/**
 * A completed request, as one Axiom event.
 *
 * Companion to the error events: those say what broke, these say what the traffic looked like —
 * which procedures are called, how often, how slow, and what proportion fail.
 */
interface RequestLike {
  method: string
  url: string
  id?: unknown
}

interface ReplyLike {
  statusCode: number
  /** Not getResponseTime(): that method is deprecated in Fastify 4 — it warns on every cold
   *  start — and is removed in Fastify 5. */
  elapsedTime: number
}

export function toRequestEvent(request: RequestLike, reply: ReplyLike): object {
  // Query string dropped, deliberately and not just for tidiness: a batched tRPC GET carries the
  // procedure input there, cursors included. The path keeps the comma-joined procedure list,
  // which is the part worth querying on.
  const path = request.url.split('?')[0]
  return {
    ...axiomEnvelope(),
    // A 4xx/5xx is still an answered request; the level is what separates it from healthy
    // traffic at query time. 207 is a tRPC batch with mixed results, not a failure in itself.
    level: reply.statusCode >= 400 ? 'warn' : 'info',
    service: 'tofi-backend',
    ...(request.id ? { requestId: String(request.id) } : {}),
    http: {
      method: request.method,
      path,
      statusCode: reply.statusCode,
      durationMs: Math.round(reply.elapsedTime * 100) / 100,
    },
  }
}
