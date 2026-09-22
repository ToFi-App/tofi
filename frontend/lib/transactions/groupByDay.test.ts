import { describe, expect, it } from 'vitest'
import { groupByDay } from './groupByDay'
import type { FeedItem } from './resolveFeed'

function item(id: string, date: string): FeedItem {
  return {
    id,
    source: 'plaid',
    amount: 10,
    date,
    postedDate: date,
    merchantName: 'x',
    categoryId: null,
    subcategoryId: null,
    categorySource: 'uncategorized',
    confidenceLevel: null,
    pfcDetailed: null,
    accountId: 'checking',
    pending: false,
    note: null,
    reimbursedAmount: null,
    netAmount: null,
    isReimbursementIncome: false,
    reimbursementCategoryId: null,
    transferId: null,
    transferKind: null,
    transferRole: null,
    transferSource: null,
    isBrokerageCashAccount: false,
    isSweptOutflow: false,
    hasCrossAccountCounterpart: false,
    links: [],
  }
}

describe('groupByDay', () => {
  it('buckets by date, newest day first', () => {
    const groups = groupByDay([
      item('a', '2026-07-10'),
      item('b', '2026-07-15'),
      item('c', '2026-07-10'),
    ])

    expect(groups.map((g) => g.date)).toEqual(['2026-07-15', '2026-07-10'])
    expect(groups[1].items.map((i) => i.id)).toEqual(['a', 'c'])
  })

  // Lexical order on a zero-padded key is chronological, including across month and year ends —
  // which is the reason these are never parsed into Dates to sort.
  it('orders across month and year boundaries', () => {
    const groups = groupByDay([
      item('a', '2026-01-02'),
      item('b', '2025-12-31'),
      item('c', '2026-02-01'),
    ])

    expect(groups.map((g) => g.date)).toEqual(['2026-02-01', '2026-01-02', '2025-12-31'])
  })

  it('returns nothing for an empty feed', () => {
    expect(groupByDay([])).toEqual([])
  })
})
