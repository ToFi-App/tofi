import { useEffect, useRef } from 'react'

const listeners = new Set<() => void>()

/**
 * Asks Home to go back to its starting point: the Summary view, scrolled to the top. Sent by the tab
 * bar when Home's tab is tapped while Home is already showing. iOS pops the tab's stack and scrolls
 * its first scroll view on a re-tap by itself, but Home's page scrolls inside the teal header's
 * layout and the Charts view leads with a sideways pager, so neither is the view iOS goes looking for.
 */
export function requestHomeTop() {
  for (const listener of listeners) listener()
}

/** Runs `onRequest` whenever Home's tab is tapped again while Home is showing (requestHomeTop). */
export function useHomeTabReselect(onRequest: () => void) {
  const latest = useRef(onRequest)
  latest.current = onRequest
  useEffect(() => {
    const listener = () => latest.current()
    listeners.add(listener)
    return () => {
      listeners.delete(listener)
    }
  }, [])
}
