import { useSyncExternalStore } from 'react'

let selected: string | null = null
const listeners = new Set<() => void>()

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

function setSelectedAccountFilter(accountId: string | null) {
  if (accountId === selected) return
  selected = accountId
  for (const listener of listeners) listener()
}

/**
 * The account Home and the Calendar tab are filtered to, or null for all of them. Shared like
 * useSelectedMonth, so the two tabs always show the same slice of the feed.
 */
export function useSelectedAccountFilter() {
  const accountId = useSyncExternalStore(subscribe, () => selected)
  return [accountId, setSelectedAccountFilter] as const
}
