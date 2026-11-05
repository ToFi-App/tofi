import { useSyncExternalStore } from 'react'

let selected: string | null = null
const listeners = new Set<() => void>()

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/**
 * Which investment account the Investments view shows, or null for all of them. Module state rather
 * than a route param because Net Worth sets it right before switching to that view (useNetWorthScope),
 * from a screen that isn't a route of its own.
 */
export function setInvestmentAccountFilter(accountId: string | null) {
  if (accountId === selected) return
  selected = accountId
  for (const listener of listeners) listener()
}

export function useInvestmentAccountFilter() {
  const accountId = useSyncExternalStore(subscribe, () => selected)
  return [accountId, setInvestmentAccountFilter] as const
}
