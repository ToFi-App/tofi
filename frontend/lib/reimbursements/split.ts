import { formatAmount } from '@/lib/format/money'
import type { FeedItem } from '@/lib/transactions/resolveFeed'
import { remainingExpense } from './suggest'

/**
 * Splitting one income across several expenses — a $100 Venmo that was $50 of one dinner, $20 of
 * groceries and $30 of tickets. Each pair gets its own share, and the shares can't add up to more
 * than came in, nor give any one charge more than it still owes. Whatever isn't allocated stays
 * income, exactly as an unsplit surplus does.
 */

const CENT = 0.005

function roundCents(value: number): number {
  return Math.round(value * 100) / 100
}

/** The share a charge gets when it's picked: what it still owes, or what's left of the income. */
export function suggestShare(expense: FeedItem, incomeLeft: number): number {
  return roundCents(Math.max(0, Math.min(remainingExpense(expense), incomeLeft)))
}

/** A typed share as dollars, or null while it isn't a usable amount yet. */
export function parseShare(text: string): number | null {
  const trimmed = text.trim().replace(/^\$/, '').replace(/,/g, '')
  if (trimmed === '' || trimmed === '.' || !/^\d*\.?\d{0,2}$/.test(trimmed)) return null
  return Number(trimmed)
}

export interface SplitRow {
  expense: FeedItem
  share: number | null
}

export interface SplitCheck {
  /** Sum of the usable shares. */
  allocated: number
  /** Income not yet given to any charge, which stays income. Zero when over-allocated. */
  left: number
  /** How far the shares run past the income. Zero unless over-allocated. */
  over: number
  /** Why a row's share can't be saved, keyed by expense id. */
  rowErrors: Record<string, string>
  isValid: boolean
}

export function checkSplit(incomeAvailable: number, rows: SplitRow[]): SplitCheck {
  const rowErrors: Record<string, string> = {}
  let allocated = 0
  for (const { expense, share } of rows) {
    if (share == null || share < 0.01) {
      rowErrors[expense.id] = 'Enter an amount'
      continue
    }
    const owed = remainingExpense(expense)
    if (share > owed + CENT) rowErrors[expense.id] = `Only ${formatAmount(owed)} left on this charge`
    allocated += share
  }
  allocated = roundCents(allocated)
  const over = roundCents(Math.max(0, allocated - incomeAvailable))
  return {
    allocated,
    left: roundCents(Math.max(0, incomeAvailable - allocated)),
    over,
    rowErrors,
    isValid: rows.length > 0 && Object.keys(rowErrors).length === 0 && over < CENT,
  }
}
