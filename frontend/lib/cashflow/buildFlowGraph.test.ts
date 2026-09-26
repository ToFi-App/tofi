import { describe, expect, it } from 'vitest'
import { aggregateMonth } from '@/lib/transactions/aggregateMonth'
import { filterByMonth } from '@/lib/transactions/filterByMonth'
import type { FeedItem, FeedLink } from '@/lib/transactions/resolveFeed'
import { buildFlowGraph, UNLINKED_NODE, type FlowAccount } from './buildFlowGraph'
import { buildHouseholdFlow, laneAmountText, layoutHousehold, pillWidth } from './householdFlow'

function item(overrides: Partial<FeedItem> & { id: string }): FeedItem {
  return {
    source: 'plaid',
    amount: 0,
    date: '2026-06-10',
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
    ...overrides,
    postedDate: overrides.postedDate ?? overrides.date ?? '2026-06-10',
  }
}

function link(itemId: string | null): FeedLink {
  return { recordId: 't', kind: 'account_transfer', itemId, merchantName: null, date: null, accountId: null, amount: 0 }
}

/** Both legs of a paired transfer, outflow first. */
function transfer(id: string, from: string, to: string, amount: number, kind: FeedItem['transferKind'] = 'account_transfer', date = '2026-06-15') {
  return [
    item({ id: `${id}-out`, accountId: from, amount, date, transferId: id, transferKind: kind, transferRole: 'expense', links: [link(`${id}-in`)] }),
    item({ id: `${id}-in`, accountId: to, amount: -amount, date, transferId: id, transferKind: kind, transferRole: 'income', links: [link(`${id}-out`)] }),
  ]
}

const accounts: FlowAccount[] = [
  { account_id: 'checking', name: 'Checking', type: 'depository', subtype: 'checking', balances: { current: 1000 } },
  { account_id: 'savings', name: 'Savings', type: 'depository', subtype: 'savings', balances: { current: 5000 } },
  { account_id: 'brokerage', name: 'Brokerage', type: 'investment', subtype: 'brokerage', balances: { current: 20000 } },
  { account_id: 'card', name: 'Card', type: 'credit', subtype: 'credit card', balances: { current: 300 } },
]
const month = { year: 2026, month: 6 }

const feed: FeedItem[] = [
  item({ id: 'pay', amount: -4000, categoryId: 'salary' }),
  item({ id: 'rent', amount: 1500, categoryId: 'rent' }),
  item({ id: 'dinner', accountId: 'card', amount: 100, netAmount: 40, reimbursedAmount: 60, categoryId: 'food' }),
  item({ id: 'refund', accountId: 'card', amount: -20, categoryId: 'shopping' }),
  item({ id: 'zelle-back', amount: -60, isReimbursementIncome: true }),
  item({ id: 'groceries', accountId: 'card', amount: 200, categoryId: 'food' }),
  ...transfer('save', 'checking', 'savings', 500),
  ...transfer('unsave', 'savings', 'checking', 200),
  ...transfer('invest', 'checking', 'brokerage', 1000),
  ...transfer('cardpay', 'checking', 'card', 250, 'credit_card_payment'),
  item({ id: 'venmo', amount: 80, transferId: 'v', transferKind: 'account_transfer', transferRole: 'expense', links: [link(null)] }),
  item({ id: 'pending', amount: 999, pending: true }),
  item({ id: 'sweep', accountId: 'brokerage', amount: 300, isSweptOutflow: true, isBrokerageCashAccount: true }),
  item({ id: 'later', amount: 50, date: '2026-07-02', categoryId: 'food' }),
]

describe('buildFlowGraph', () => {
  const graph = buildFlowGraph({ feed, accounts, month })

  it('matches aggregateMonth income and spending exactly', () => {
    const aggregate = aggregateMonth(filterByMonth(feed, month))
    expect(graph.headline.income).toBe(aggregate.totalIncome)
    expect(graph.headline.spending).toBe(aggregate.totalExpense)
  })

  it('splits the net into parts that sum back to it', () => {
    const h = graph.headline
    expect(h.saved + h.invested + h.debtPaid + h.checkingChange + h.unlinked + h.reimbursements).toBeCloseTo(h.net, 2)
    expect(h.saved).toBe(300) // 500 in, 200 back out, netted
    expect(h.invested).toBe(1000)
    // 250 paid + 20 refund - 40 net dinner - 200 groceries
    expect(h.debtPaid).toBe(30)
    expect(h.unlinked).toBe(80)
  })

  it('keeps transfers in each direction as separate edges', () => {
    const toSavings = graph.edges.find((e) => e.from === 'account:checking' && e.to === 'account:savings')
    const back = graph.edges.find((e) => e.from === 'account:savings' && e.to === 'account:checking')
    expect(toSavings).toMatchObject({ kind: 'saved', amount: 500 })
    expect(back).toMatchObject({ kind: 'moved', amount: 200 })
  })

  it('names a card payment debt paid down and draws card purchases from the card', () => {
    expect(graph.edges.find((e) => e.from === 'account:checking' && e.to === 'account:card')?.kind).toBe('debtPaid')
    expect(graph.edges.find((e) => e.from === 'account:card' && e.to === 'spend:food')?.amount).toBe(240)
  })

  it('sends an unpaired transfer to the unlinked node and flags it', () => {
    expect(graph.edges.find((e) => e.to === UNLINKED_NODE)?.amount).toBe(80)
    expect(graph.attention).toContainEqual({ itemId: 'venmo', reason: 'unpairedTransfer' })
  })

  it('counts pending rows without drawing them and ignores same-account sweeps', () => {
    expect(graph.pendingCount).toBe(1)
    expect(graph.edges.some((e) => e.itemIds.includes('pending') || e.itemIds.includes('sweep'))).toBe(false)
  })

  it('books a transfer that straddles a month boundary in the outflow month only', () => {
    const straddle = [
      item({ id: 'x-out', amount: 100, date: '2026-06-30', transferId: 'x', transferKind: 'account_transfer', transferRole: 'expense', links: [link('x-in')] }),
      item({ id: 'x-in', accountId: 'savings', amount: -100, date: '2026-07-01', transferId: 'x', transferKind: 'account_transfer', transferRole: 'income', links: [link('x-out')] }),
    ]
    expect(buildFlowGraph({ feed: straddle, accounts, month }).headline.saved).toBe(100)
    expect(buildFlowGraph({ feed: straddle, accounts, month: { year: 2026, month: 7 } }).headline.saved).toBe(0)
  })

  it('gives no savings rate for a month without income', () => {
    const noIncome = buildFlowGraph({ feed: [item({ id: 'a', amount: 10 })], accounts, month })
    expect(noIncome.headline.savingsRate).toBeNull()
  })

  it('back-casts statements that reconcile start + in - out = end', () => {
    for (const s of graph.statements) {
      if (s.start == null || s.end == null) continue
      const sign = s.isLiability ? -1 : 1
      expect(sign * s.end).toBeCloseTo(sign * s.start + s.moneyIn - s.moneyOut, 2)
    }
    const checking = graph.statements.find((s) => s.accountId === 'checking')!
    // July's $50 is unwound from today's $1000 balance.
    expect(checking.end).toBe(1050)
    expect(graph.statements.find((s) => s.accountId === 'brokerage')?.flowsOnly).toBe(true)
  })
})

describe('reimbursements', () => {
  const reimbLink = (itemId: string, amount: number): FeedLink => ({ ...link(itemId), kind: 'reimbursement', amount })

  it('keeps a fully reimbursed expense in the chart and lands the repayment where it arrived', () => {
    const rows = [
      // Paid from checking, repaid in full into savings.
      item({ id: 'trip', amount: 500, netAmount: 0, reimbursedAmount: 500, categoryId: 'travel', links: [reimbLink('repay', 500)] }),
      item({ id: 'repay', accountId: 'savings', amount: -500, isReimbursementIncome: true, links: [link('trip')] }),
    ]
    const g = buildFlowGraph({ feed: rows, accounts, month })
    expect(g.headline.spending).toBe(0)
    expect(g.headline.income).toBe(0)
    expect(g.edges.find((e) => e.kind === 'covered')).toMatchObject({ from: 'account:checking', to: 'spend:travel', amount: 500 })
    expect(g.edges.find((e) => e.kind === 'paidBack')).toMatchObject({ to: 'account:savings', amount: 500 })
    // Real movement: checking -500, savings +500.
    expect(g.headline.checkingChange).toBe(-500)
    expect(g.headline.saved).toBe(500)
  })

  it('draws nothing extra when the repayment lands back in the paying account', () => {
    const rows = [
      item({ id: 'lunch', amount: 30, netAmount: 10, reimbursedAmount: 20, categoryId: 'food', links: [reimbLink('venmo-in', 20)] }),
      item({ id: 'venmo-in', amount: -20, isReimbursementIncome: true, links: [link('lunch')] }),
    ]
    const g = buildFlowGraph({ feed: rows, accounts, month })
    expect(g.edges.map((e) => e.kind)).toEqual(['spend'])
    expect(g.edges[0].amount).toBe(10)
  })

  it('adds the reimbursed part to the category when repaid into another account', () => {
    const rows = [
      item({ id: 'dinner3', accountId: 'card', amount: 100, netAmount: 40, reimbursedAmount: 60, categoryId: 'food', links: [reimbLink('zelle3', 60)] }),
      item({ id: 'zelle3', amount: -60, isReimbursementIncome: true, links: [link('dinner3')] }),
    ]
    const flow = buildHouseholdFlow(buildFlowGraph({ feed: rows, accounts, month }), { maxIncome: 4, maxSpend: 6 })
    expect(flow.ribbons.find((r) => r.to === 'spend:food')?.amount).toBe(100)
    expect(flow.ribbons.find((r) => r.from === 'paidBack')).toMatchObject({ to: 'account:checking', amount: 60 })
    expect(flow.outNodes.map((n) => n.id)).toEqual(['spend:food'])
  })

  it('books a repayment in the month it arrived, not the expense\'s month', () => {
    const rows = [
      item({ id: 'concert', amount: 90, netAmount: 30, reimbursedAmount: 60, categoryId: 'fun', date: '2026-06-28', links: [reimbLink('pay-back', 60)] }),
      // Repaid next month, into the same account: different months, so it doesn't cancel.
      item({ id: 'pay-back', amount: -60, date: '2026-07-03', isReimbursementIncome: true, links: [link('concert')] }),
    ]
    const june = buildFlowGraph({ feed: rows, accounts, month })
    const july = buildFlowGraph({ feed: rows, accounts, month: { year: 2026, month: 7 } })
    expect(june.edges.find((e) => e.kind === 'covered')?.amount).toBe(60)
    expect(june.edges.some((e) => e.kind === 'paidBack')).toBe(false)
    expect(june.headline.reimbursements).toBe(60)
    expect(july.edges.find((e) => e.kind === 'paidBack')).toMatchObject({ to: 'account:checking', amount: 60 })
    expect(july.headline.reimbursements).toBe(-60)
    for (const h of [june.headline, july.headline]) {
      expect(h.saved + h.invested + h.debtPaid + h.checkingChange + h.unlinked + h.reimbursements).toBeCloseTo(h.net, 2)
    }
  })

  it('splits a partly reimbursed expense into your share and the covered part', () => {
    const rows = [
      item({ id: 'dinner2', accountId: 'card', amount: 100, netAmount: 40, reimbursedAmount: 60, categoryId: 'food', links: [reimbLink('zelle', 60)] }),
      item({ id: 'zelle', amount: -60, isReimbursementIncome: true, links: [link('dinner2')] }),
    ]
    const g = buildFlowGraph({ feed: rows, accounts, month })
    expect(g.headline.spending).toBe(40)
    expect(g.headline.debtPaid).toBe(-100) // the card was charged the full 100
    expect(g.headline.checkingChange).toBe(60)
    const h = g.headline
    expect(h.saved + h.invested + h.debtPaid + h.checkingChange + h.unlinked + h.reimbursements).toBeCloseTo(h.net, 2)
  })
})

describe('household flow', () => {
  const graph = buildFlowGraph({ feed, accounts, month })
  const flow = buildHouseholdFlow(graph, { maxIncome: 4, maxSpend: 6 })
  const lane = (from: string, to: string) => flow.lanes.find((l) => l.from === from && l.to === to)

  it('keeps only income on the left and only spending or unlinked on the right', () => {
    expect(flow.inNodes.every((n) => n.kind === 'income' || n.kind === 'otherIncome' || n.kind === 'fromUnlinked')).toBe(true)
    expect(flow.outNodes.every((n) => n.kind === 'spend' || n.kind === 'otherSpend' || n.kind === 'toUnlinked')).toBe(true)
    expect(flow.ribbons.find((r) => r.from === 'income:salary')?.to).toBe('account:checking')
  })

  it('draws every transfer between accounts as a lane, each direction separately', () => {
    expect(lane('account:checking', 'account:savings')).toMatchObject({ kind: 'saved', amount: 500 })
    expect(lane('account:savings', 'account:checking')).toMatchObject({ amount: 200 })
    expect(lane('account:checking', 'account:brokerage')).toMatchObject({ kind: 'invested', amount: 1000 })
    expect(lane('account:checking', 'account:card')).toMatchObject({ kind: 'debtPaid', amount: 250 })
  })

  it('leaves out accounts with no activity, investments included', () => {
    const idle = buildHouseholdFlow(buildFlowGraph({ feed: [item({ id: 'a', amount: 10, categoryId: 'food' })], accounts, month }), { maxIncome: 4, maxSpend: 6 })
    expect(idle.cards.map((c) => c.id)).toEqual(['account:checking'])
  })

  it('shows each account once, cards last, with its balance change', () => {
    expect(flow.cards.map((c) => c.id)).toEqual(['account:checking', 'account:savings', 'account:brokerage', 'account:card'])
    // Card: 250 paid + 20 refunded - 240 charged = 30 less owed.
    expect(flow.cards.find((c) => c.id === 'account:card')?.balanceChange).toBe(30)
    expect(flow.cards.find((c) => c.id === 'account:savings')?.balanceChange).toBe(300)
  })

  describe('layout', () => {
    const options = {
      inLabelWidth: 150, outLabelWidth: 150, barWidth: 8, ribbonSpan: 70, cardWidth: 132, trackGap: 26, minCard: 56, cardGap: 18,
      portGap: 16, minSlot: 36, targetHeight: 260, laneMin: 2, laneMax: 8,
    }
    // Every fixture lane touches checking, so selecting it draws them all.
    const layout = layoutHousehold(flow, options, 'account:checking')

    it('draws no lanes until a card is selected, then only that card\'s', () => {
      expect(layoutHousehold(flow, options).lanes).toHaveLength(0)
      const savingsLanes = layoutHousehold(flow, options, 'account:savings').lanes.map((l) => l.id)
      expect(savingsLanes.sort()).toEqual(['account:checking->account:savings', 'account:savings->account:checking'])
    })

    it('does not move anything when a card is selected', () => {
      const idle = layoutHousehold(flow, options)
      expect(layout.cards).toEqual(idle.cards)
      expect(layout.width).toBe(idle.width)
    })

    it('never stacks two lanes on one track where their spans overlap', () => {
      const xs = layout.lanes.map((l) => l.labelX)
      // checking<->savings (both directions) and checking->brokerage/card all share checking.
      expect(new Set(xs).size).toBe(layout.lanes.length)
    })

    it('puts shorter lanes on inner tracks', () => {
      const x = (id: string) => layout.lanes.find((l) => l.id === id)!.labelX
      // Inner = closer to the cards = larger x.
      expect(x('account:checking->account:savings')).toBeGreaterThan(x('account:checking->account:card'))
    })

    it('keeps every amount pill clear of the account blocks and of other lanes\' pills', () => {
      const cardX = layout.cards[0].x
      const widths = flow.lanes.map((l) => Math.max(pillWidth(laneAmountText(l.amount)), pillWidth('$****')))
      layout.lanes.forEach((lane, i) => expect(lane.labelX + widths[i] / 2).toBeLessThanOrEqual(cardX))
      const xs = [...new Set(layout.lanes.map((l) => l.labelX))].sort((a, b) => a - b)
      const widest = Math.max(...widths)
      for (let i = 1; i < xs.length; i++) expect(xs[i] - xs[i - 1]).toBeGreaterThanOrEqual(widest)
    })

    it('keeps cards from overlapping', () => {
      for (let i = 1; i < layout.cards.length; i++) {
        expect(layout.cards[i].y).toBeGreaterThanOrEqual(layout.cards[i - 1].y + layout.cards[i - 1].height)
      }
    })

    it('gives every side row a slot tall enough for its label', () => {
      for (const node of [...layout.inNodes, ...layout.outNodes]) expect(node.slotHeight).toBeGreaterThanOrEqual(36)
    })
  })
})
