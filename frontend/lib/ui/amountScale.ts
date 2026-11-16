/**
 * The amount slider's scale. A month's amounts crowd the low end — dozens of coffees, one rent —
 * so a linear track would spend nearly all its length on the few large rows. Squaring the position
 * gives the low end most of the track: halfway along is a quarter of the top.
 */

/** The month's largest amount, rounded up to 1, 2 or 5 of its power of ten: 730 → 1,000, 1,800 → 2,000. */
export function niceCeiling(value: number): number {
  if (value <= 0) return 100
  const power = 10 ** Math.floor(Math.log10(value))
  const step = [1, 2, 5, 10].find((m) => m * power >= value) ?? 10
  return step * power
}

/** Rounds to a step that suits the size: dollars under $100, tens under $1,000, fifties above. */
function roundToStep(amount: number): number {
  const step = amount < 100 ? 1 : amount < 1000 ? 10 : 50
  return Math.round(amount / step) * step
}

/** A position along the track (0–1) as an amount. */
export function positionToAmount(position: number, max: number): number {
  const clamped = Math.min(1, Math.max(0, position))
  return Math.min(max, roundToStep(max * clamped * clamped))
}

/** An amount as a position along the track (0–1). */
export function amountToPosition(amount: number, max: number): number {
  if (max <= 0) return 0
  return Math.sqrt(Math.min(1, Math.max(0, amount / max)))
}
