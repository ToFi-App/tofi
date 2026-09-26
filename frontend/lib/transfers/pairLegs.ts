import type { FeedItem } from '@/lib/transactions/resolveFeed'

/** Both legs of one transfer: the money leaving one account and the same money arriving in another. */
export interface LegPair {
  transferId: string
  outflow: FeedItem
  inflow: FeedItem
}

/**
 * Splits a list into transfers whose two legs are BOTH present, and everything else.
 *
 * A list that shows a transfer as two unrelated rows (-$500 here, +$500 there) makes the reader do
 * the pairing; one pair reads as what it is, one movement between two accounts. A transfer with only
 * one leg in the list stays a single row, since there is nothing to pair it with.
 *
 * Pairs are newest first by their later leg, matching the day-grouped list the singles go into.
 */
export function pairTransferLegs(items: FeedItem[]): { pairs: LegPair[]; singles: FeedItem[] } {
  const byTransfer = new Map<string, { outflow?: FeedItem; inflow?: FeedItem }>()
  for (const item of items) {
    if (item.transferId == null || item.transferRole == null) continue
    const entry = byTransfer.get(item.transferId) ?? {}
    if (item.transferRole === 'expense') entry.outflow = item
    else entry.inflow = item
    byTransfer.set(item.transferId, entry)
  }

  const pairs: LegPair[] = []
  const paired = new Set<string>()
  for (const [transferId, { outflow, inflow }] of byTransfer) {
    if (!outflow || !inflow) continue
    pairs.push({ transferId, outflow, inflow })
    paired.add(outflow.id)
    paired.add(inflow.id)
  }

  const latest = (pair: LegPair) => (pair.outflow.date > pair.inflow.date ? pair.outflow.date : pair.inflow.date)
  pairs.sort((a, b) => latest(b).localeCompare(latest(a)))
  return { pairs, singles: items.filter((item) => !paired.has(item.id)) }
}
