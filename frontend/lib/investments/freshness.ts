/**
 * The oldest of several ISO 8601 instants, skipping missing ones; null when none is known.
 *
 * Positions shown together are only as current as the least recently synced institution among
 * them, so that is the time to report — the newest would let one fresh brokerage vouch for a stale
 * one beside it. Parsed rather than compared as strings: "2026-08-23" and "2026-08-23T20:00:00Z"
 * don't sort by prefix.
 */
export function oldestInstant(instants: Array<string | null | undefined>): string | null {
  let oldest: string | null = null
  for (const instant of instants) {
    if (!instant || Number.isNaN(Date.parse(instant))) continue
    if (oldest == null || Date.parse(instant) < Date.parse(oldest)) oldest = instant
  }
  return oldest
}
