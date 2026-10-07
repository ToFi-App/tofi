/** Smallest and largest radius of a chart's event dots (trades, deposits). */
export const MARKER_MIN_R = 3
export const MARKER_MAX_R = 8

/**
 * A dot's radius for an event of `size` among events whose biggest is `largest`. Area, not
 * diameter, follows the size, so one large event reads as large beside routine ones without the
 * small ones shrinking to nothing.
 */
export function markerRadius(size: number, largest: number): number {
  if (largest <= 0) return MARKER_MIN_R
  return MARKER_MIN_R + (MARKER_MAX_R - MARKER_MIN_R) * Math.sqrt(Math.max(size, 0) / largest)
}
