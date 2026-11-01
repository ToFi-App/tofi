import { useState } from 'react'
import { currentMonth, type YearMonth } from '@/lib/transactions/filterByMonth'

/**
 * The month a screen is viewing, starting on the current month. It stays where it was put: leaving
 * for another tab, or for a screen pushed over this one, and coming back finds the same month —
 * the month is what the user chose to look at, and snapping it back undid that every time.
 */
export function useSelectedMonth() {
  return useState<YearMonth>(currentMonth)
}
