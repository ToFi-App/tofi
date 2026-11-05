import { budgetStatus, type BudgetStatus } from '@/lib/budgets/budgetMath'

/** How a category tile reads: a budget's status, or no budget — which draws no ring. */
export type TileState = BudgetStatus | 'unbudgeted'

export function tileState(spent: number, budget: number | null, elapsed: number): TileState {
  return budget == null ? 'unbudgeted' : budgetStatus(spent, budget, elapsed)
}

const STATE_RANK: Record<TileState, number> = { over: 0, 'at-risk': 1, 'on-track': 2, unbudgeted: 2 }

/** How many categories get a two-column tile, and the share of the month one must hold to earn it. */
const MAX_WIDE = 2
const WIDE_SHARE = 0.15

export interface TileInput {
  id: string
  spent: number
  state: TileState
}

/**
 * The grid's order and which tiles go wide. Problems lead — over, then running hot — so a blown
 * budget is never below the fold; the rest follow by size. The biggest categories get two columns,
 * but only when they're a real share of the month: on a quiet month nothing is big enough to.
 */
export function arrangeTiles<T extends TileInput>(tiles: T[], monthTotal: number): Array<T & { wide: boolean }> {
  const ordered = [...tiles].sort((a, b) => STATE_RANK[a.state] - STATE_RANK[b.state] || b.spent - a.spent)
  const wideIds = new Set(
    [...tiles]
      .filter((t) => monthTotal > 0 && t.spent / monthTotal >= WIDE_SHARE)
      .sort((a, b) => b.spent - a.spent)
      .slice(0, MAX_WIDE)
      .map((t) => t.id),
  )
  return ordered.map((t) => ({ ...t, wide: wideIds.has(t.id) }))
}

/**
 * Packs tiles into rows three columns wide. A wide tile that won't fit the row's last column waits
 * for the next row, and the next small tile after it backfills the gap, so rows only come up short
 * at the very end. Wide tiles alternate sides row to row, which keeps the grid from reading as two
 * columns of big tiles and one of small ones.
 */
export function packRows<T extends { wide: boolean }>(tiles: T[]): T[][] {
  const queue = [...tiles]
  const rows: T[][] = []
  let wideOnLeft = true
  while (queue.length > 0) {
    const row: T[] = []
    let used = 0
    while (used < 3 && queue.length > 0) {
      const space = 3 - used
      const index = queue.findIndex((t) => !t.wide || space >= 2)
      if (index === -1) break
      const [tile] = queue.splice(index, 1)
      row.push(tile)
      used += tile.wide ? 2 : 1
    }
    const wide = row.find((t) => t.wide)
    if (wide && !wideOnLeft) {
      row.splice(row.indexOf(wide), 1)
      row.push(wide)
    }
    if (wide) wideOnLeft = !wideOnLeft
    rows.push(row)
  }
  return rows
}
