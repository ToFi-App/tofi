/** How many category squares a calendar cell has room for; any further categories become "+". */
export const MAX_DAY_SQUARES = 4

export interface DaySquare {
  /** Category id, or null for uncategorized spending. */
  key: string | null
  color: string
  /** This category's share of the day's spending, 0..1 — the square's shade. */
  share: number
}

/**
 * A day's spending as calendar squares, GitHub-activity style: one per category, largest first,
 * each shaded by its share of the day so the category that dominated reads darkest. Capped at
 * MAX_DAY_SQUARES, with `more` set when categories were left out.
 */
export function daySquares(
  byCategory: Map<string | null, number> | undefined,
  colorOf: (categoryId: string | null) => string,
): { squares: DaySquare[]; more: boolean } {
  if (!byCategory || byCategory.size === 0) return { squares: [], more: false }
  let total = 0
  for (const amount of byCategory.values()) total += amount
  const ranked = [...byCategory.entries()].sort((a, b) => b[1] - a[1])
  return {
    squares: ranked.slice(0, MAX_DAY_SQUARES).map(([key, amount]) => ({
      key,
      color: colorOf(key),
      share: total > 0 ? amount / total : 0,
    })),
    more: ranked.length > MAX_DAY_SQUARES,
  }
}

export interface DayHeat {
  /** Which way the day went on net: spending (red) or income (green). */
  tone: 'expense' | 'income'
  /** How strongly, 0..1, against the month's biggest day of the same tone. */
  intensity: number
}

/**
 * A day's heat shade from its NET — the same figure, and so the same colour, as the amount printed
 * on it: red for a net spending day, green for a net income day. Each tone has its own scale, so a
 * paycheck day at full green doesn't shrink every spending day to nothing. `net` follows the feed
 * convention: positive is money out.
 */
export function dayHeat(net: number | null, extremes: { biggestSpend: number; biggestIncome: number }): DayHeat {
  if (net == null || net === 0) return { tone: 'expense', intensity: 0 }
  if (net > 0) {
    return { tone: 'expense', intensity: extremes.biggestSpend > 0 ? Math.min(net / extremes.biggestSpend, 1) : 0 }
  }
  return { tone: 'income', intensity: extremes.biggestIncome > 0 ? Math.min(-net / extremes.biggestIncome, 1) : 0 }
}

/**
 * Gradient stops blending a day's categories across its calendar cell: each colour sits at the
 * middle of its share, so a category holding half the day holds about half the cell, and the gap
 * between two middles is where they blend. Shares are renormalised over the categories shown, so a
 * capped list still spans the whole cell.
 */
export function blendStops(squares: DaySquare[]): { offset: number; color: string }[] {
  if (squares.length === 0) return []
  const first = squares[0].color
  const last = squares[squares.length - 1].color
  if (squares.length === 1) return [{ offset: 0, color: first }, { offset: 1, color: first }]
  const total = squares.reduce((sum, s) => sum + s.share, 0) || 1
  const stops = [{ offset: 0, color: first }]
  let start = 0
  for (const square of squares) {
    const width = square.share / total
    stops.push({ offset: Math.round((start + width / 2) * 1e6) / 1e6, color: square.color })
    start += width
  }
  stops.push({ offset: 1, color: last })
  return stops
}
