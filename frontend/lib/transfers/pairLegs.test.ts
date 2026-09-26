import { describe, expect, it } from 'vitest'
import type { FeedItem } from '@/lib/transactions/resolveFeed'
import { pairTransferLegs } from './pairLegs'

function leg(id: string, transferId: string | null, role: FeedItem['transferRole'], date: string): FeedItem {
  return { id, transferId, transferRole: role, date } as FeedItem
}

describe('pairTransferLegs', () => {
  it('pairs legs of the same transfer and leaves the rest as single rows', () => {
    const { pairs, singles } = pairTransferLegs([
      leg('a-out', 't1', 'expense', '2026-06-20'),
      leg('a-in', 't1', 'income', '2026-06-17'),
      leg('lonely', 't2', 'expense', '2026-06-10'),
      leg('coffee', null, null, '2026-06-05'),
    ])
    expect(pairs).toHaveLength(1)
    expect(pairs[0]).toMatchObject({ transferId: 't1', outflow: { id: 'a-out' }, inflow: { id: 'a-in' } })
    expect(singles.map((s) => s.id)).toEqual(['lonely', 'coffee'])
  })

  it('orders pairs newest first by their later leg', () => {
    const { pairs } = pairTransferLegs([
      leg('old-out', 'old', 'expense', '2026-06-06'),
      leg('old-in', 'old', 'income', '2026-06-03'),
      leg('new-out', 'new', 'expense', '2026-06-20'),
      leg('new-in', 'new', 'income', '2026-06-17'),
    ])
    expect(pairs.map((p) => p.transferId)).toEqual(['new', 'old'])
  })
})
