import { useSyncExternalStore } from 'react'

export type NetWorthScope = 'overview' | 'investments'

let scope: NetWorthScope = 'overview'
const listeners = new Set<() => void>()

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/**
 * Which of the Net Worth tab's two views is showing. Module state, like the investment account
 * filter, because Net Worth's investment rows switch to Investments from inside the view being
 * replaced, and the choice should survive leaving the tab and coming back.
 */
export function setNetWorthScope(next: NetWorthScope) {
  if (next === scope) return
  scope = next
  for (const listener of listeners) listener()
}

export function useNetWorthScope() {
  const current = useSyncExternalStore(subscribe, () => scope)
  return [current, setNetWorthScope] as const
}
