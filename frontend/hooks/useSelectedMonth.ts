import { useSyncExternalStore } from 'react'
import { currentMonth, type YearMonth } from '@/lib/transactions/filterByMonth'

let selected: YearMonth = currentMonth()
const listeners = new Set<() => void>()

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

function setSelectedMonth(month: YearMonth) {
  if (month.year === selected.year && month.month === selected.month) return
  selected = month
  for (const listener of listeners) listener()
}

/**
 * The month Home and the Calendar tab are viewing, starting on the current month. One month for
 * both, so stepping to October on one finds October on the other. It stays where it was put:
 * leaving for another tab, or for a screen pushed over this one, and coming back finds the same
 * month — the month is what the user chose to look at, and snapping it back undid that every time.
 */
export function useSelectedMonth() {
  const month = useSyncExternalStore(subscribe, () => selected)
  return [month, setSelectedMonth] as const
}
