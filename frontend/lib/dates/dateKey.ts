/**
 * A calendar day as `YYYY-MM-DD`, carrying no timezone — the form every date in the feed takes,
 * and the form Plaid's own `date` and `authorized_date` already arrive in.
 *
 * These exist because both obvious conversions are UTC, and neither looks like it:
 * `Date.toISOString().slice(0, 10)` reads the UTC day off an instant, and `new Date('2026-08-20')`
 * parses a bare day key AS UTC midnight. Either one shifts the day by one on any device not on
 * UTC — forward for a device behind it, backward for one ahead — so an evening purchase lands on
 * tomorrow and an early-morning one on yesterday.
 *
 * Every conversion between a `Date` and a day key goes through here, so that can't be
 * reintroduced one call site at a time.
 */
export function toDateKey(date: Date): string {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

export function fromDateKey(dateKey: string): Date {
  const [year, month, day] = dateKey.split('-').map(Number)
  return new Date(year, month - 1, day)
}
