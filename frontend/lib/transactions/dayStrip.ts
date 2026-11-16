/**
 * The arithmetic behind the Calendar's collapsed day strip. Worklets, so the scroll handler can call
 * them on the UI thread without a hop to JS on every frame.
 */

export interface DayOffset {
  date: string
  /** The day card's top, in scroll-content coordinates. */
  y: number
  height: number
}

/** How much of a card has to show below the bar for it to be the day being read. */
export const MIN_VISIBLE = 48

/**
 * The day being read: the topmost card still showing at least MIN_VISIBLE below `barBottom` (the
 * bar's bottom edge, in content coordinates). A card all but scrolled under the bar — its last row
 * peeking out — has been read; the one under it is being read.
 *
 * `atEnd` (scrolled to the bottom) picks the last card instead: the last days may be too short to
 * ever reach the top, and would otherwise never get their turn. Offsets in any order.
 */
export function activeDayAt(offsets: DayOffset[], barBottom: number, atEnd = false): string | null {
  'worklet'
  let best: DayOffset | null = null
  let last: DayOffset | null = null
  for (const offset of offsets) {
    if (last == null || offset.y > last.y) last = offset
    const showsEnough = offset.y + offset.height - barBottom >= MIN_VISIBLE
    if (showsEnough && (best == null || offset.y < best.y)) best = offset
  }
  if (atEnd) return last?.date ?? null
  return (best ?? last)?.date ?? null
}

/**
 * Where to scroll the strip so day `index` of `count` sits in the middle of the view, held inside the
 * strip's ends so it never scrolls past the first or last day. `inset` is the strip's padding at
 * either end.
 */
export function centredStripOffset(index: number, count: number, itemWidth: number, viewWidth: number, inset = 0): number {
  const contentWidth = count * itemWidth + 2 * inset
  const centred = inset + index * itemWidth + itemWidth / 2 - viewWidth / 2
  return Math.max(0, Math.min(centred, Math.max(0, contentWidth - viewWidth)))
}

/** Whether the scroll has reached the bottom of its content, within a couple of points. */
export function isScrolledToEnd(scrollY: number, viewportHeight: number, contentHeight: number): boolean {
  'worklet'
  return contentHeight > 0 && viewportHeight > 0 && scrollY >= contentHeight - viewportHeight - 2
}
