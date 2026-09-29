/**
 * Ships error events to Axiom.
 *
 * Vercel's Hobby plan keeps runtime logs for about an hour, live-tail only, and gates Log Drains
 * behind Pro — so the platform cannot be the place these are collected. That leaves pushing from
 * inside the invocation, which is what this does. The pino stdout line stays as the live-tail
 * view; this is the durable copy.
 *
 * Two rules follow from running on the error path of a request that has already failed:
 * it must never throw, and it must never wait indefinitely.
 */
const INGEST_HOST = 'https://api.axiom.co'

/**
 * The two fields every Axiom event needs regardless of what emitted it, kept in one place so
 * the backend's own error events (errorLogging.ts) and the frontend-reported ones
 * (observabilityService.ts) can't quietly drift apart on how a timestamp or environment is
 * resolved.
 */
export function axiomEnvelope(): { _time: string; env: string } {
  return {
    // Axiom reads _time as the event timestamp.
    _time: new Date().toISOString(),
    env: process.env.VERCEL_ENV ?? process.env.NODE_ENV ?? 'development',
  }
}

/**
 * Bounded so a hung sink cannot outlive its usefulness. On Vercel this no longer delays any
 * response (runAfterResponse hands the send to waitUntil), but it still occupies the invocation,
 * and on the awaited fallback path it does hold the response open. A typical ingest is well
 * inside this; the ceiling only caps the case where Axiom is unwell.
 */
export const AXIOM_TIMEOUT_MS = 1_000

function config(): { token: string; dataset: string } | null {
  const token = process.env.AXIOM_TOKEN
  const dataset = process.env.AXIOM_DATASET
  // Read per call rather than at module load: the module is imported once per serverless
  // instance, and tests configure the environment after importing.
  if (!token || !dataset) return null
  return { token, dataset }
}

/**
 * Fails a local start that would write into the production dataset.
 *
 * There is one dataset, so a token present outside Vercel means local traffic interleaves with
 * production traffic in it. The `env` field makes them separable after the fact, but silently
 * polluting the thing you consult during an incident is not worth a filter — and the mistake is
 * invisible otherwise, since the ingest succeeds. Called before the server accepts a request.
 *
 * Tests are exempt: they configure a token precisely to exercise the sink.
 */
export function assertAxiomEnvironment(): void {
  if (!process.env.AXIOM_TOKEN) return
  if (process.env.VERCEL || process.env.NODE_ENV === 'test') return
  throw new Error(
    'AXIOM_TOKEN is set outside Vercel. Local runs would write into the production dataset — ' +
      'unset it in .env (AXIOM_DATASET alone is inert) and set it on the Vercel project instead.',
  )
}

/** False in local development and in tests unless both variables are set — the sink is opt-in. */
export function isAxiomConfigured(): boolean {
  return config() !== null
}

export async function sendToAxiom(events: object[]): Promise<void> {
  if (events.length === 0) return
  const settings = config()
  if (!settings) return

  try {
    const response = await fetch(`${INGEST_HOST}/v1/datasets/${settings.dataset}/ingest`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${settings.token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(events),
      signal: AbortSignal.timeout(AXIOM_TIMEOUT_MS),
    })
    if (!response.ok) {
      // Deliberately console, not the request logger: this runs during onSend, and a failure
      // here means the durable sink is unavailable, so stdout is the only place left.
      console.error(`[axiom] ingest rejected with ${response.status}: ${await response.text()}`)
    }
  } catch (err) {
    // A dead or slow sink must not convert one failed request into a different failed request.
    console.error(`[axiom] ingest failed: ${err instanceof Error ? err.message : String(err)}`)
  }
}
