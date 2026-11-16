import { useSyncExternalStore } from 'react'
import { EMPTY_CALENDAR_FILTER, type CalendarFilter } from '@/lib/transactions/calendarFilter'

let selected: CalendarFilter = EMPTY_CALENDAR_FILTER
const listeners = new Set<() => void>()

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

function setCalendarFilter(filter: CalendarFilter) {
  if (filter === selected) return
  selected = filter
  for (const listener of listeners) listener()
}

/**
 * The Calendar tab's filter. Kept outside the screen, like useSelectedMonth, so leaving the tab
 * and coming back — or stepping to another month — finds it as it was left. Calendar's own: Home
 * and the account filter it shares with Home don't read it. It lasts until the app is closed.
 */
export function useCalendarFilter() {
  const filter = useSyncExternalStore(subscribe, () => selected)
  return [filter, setCalendarFilter] as const
}
