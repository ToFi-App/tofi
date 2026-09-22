import { axiomEnvelope, sendToAxiom } from '../lib/observability/axiom.js'
import { runAfterResponse } from '../lib/observability/afterResponse.js'

export interface ClientErrorReport {
  scope: string
  message: string
  name?: string
}

export const observabilityService = {
  /**
   * Ships a client-reported failure to the same Axiom sink the backend's own errors use.
   *
   * `userId` decides attribution, not access: a still-signed-in user's report carries it (see
   * the router's own doc for why a public procedure isn't the same as an anonymous one), and a
   * genuinely unauthenticated report is tagged as unverified rather than blended in with
   * attributed ones — a public, unthrottled endpoint can be hit by anyone who knows the URL.
   */
  async reportClientError(userId: string | null, report: ClientErrorReport): Promise<void> {
    const service = userId ? 'tofi-frontend' : 'tofi-frontend-unverified'
    // Same non-blocking-on-Vercel treatment as the backend's own error events (server.ts's
    // onSend hook) — the caller (reportError) doesn't wait on this either.
    await runAfterResponse(
      sendToAxiom([
        {
          ...axiomEnvelope(),
          level: 'error',
          service,
          scope: report.scope,
          ...(userId ? { userId } : {}),
          err: { type: report.name ?? 'Error', message: report.message },
        },
      ]),
    )
  },
}
