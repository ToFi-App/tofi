import { describe, expect, it } from 'vitest'
import {
  canJoinGroup,
  groupIdByItemId,
  hideActiveGroupMembers,
  memberItemId,
  memberRefFor,
  nextGroupColor,
  pickerCandidates,
  summarizeGroup,
  transactionCountLabel,
} from './groups'
import type { FeedItem } from '@/lib/transactions/resolveFeed'
import type { TransactionGroup, TransactionGroupMember } from '@/types/domain'
import { categoryColors } from '@/constants/theme'

function item(id: string, amount: number, date: string, extra: Partial<FeedItem> = {}): FeedItem {
  return {
    id,
    source: 'plaid',
    amount,
    date,
    postedDate: date,
    merchantName: id,
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
    reimbursementCategoryIds: [],
    transferId: null,
    transferKind: null,
    transferRole: null,
    transferSource: null,
    isBrokerageCashAccount: false,
    isSweptOutflow: false,
    hasCrossAccountCounterpart: false,
    links: [],
    ...extra,
  }
}

function group(id: string, resolvedAt: string | null = null, color: string = categoryColors.travel): TransactionGroup {
  return { id, name: id, color, icon: null, resolvedAt, createdAt: '2026-11-01T00:00:00Z' }
}

function member(groupId: string, itemId: string, manual = false): TransactionGroupMember {
  return {
    id: `${groupId}:${itemId}`,
    groupId,
    plaidTransactionId: manual ? null : itemId,
    manualTransactionId: manual ? itemId : null,
  }
}

describe('memberRefFor / memberItemId', () => {
  it('puts manual rows in the manual column and everything else in the Plaid one', () => {
    expect(memberRefFor(item('p1', 5, '2026-11-14'))).toEqual({ plaidTransactionId: 'p1', manualTransactionId: null })
    expect(memberRefFor(item('m1', 5, '2026-11-14', { source: 'manual' }))).toEqual({ plaidTransactionId: null, manualTransactionId: 'm1' })
    expect(memberRefFor(item('i1', 5, '2026-11-14', { source: 'investment' }))).toEqual({ plaidTransactionId: 'i1', manualTransactionId: null })
  })

  it('reads back whichever id is set', () => {
    expect(memberItemId(member('g', 'p1'))).toBe('p1')
    expect(memberItemId(member('g', 'm1', true))).toBe('m1')
  })
})

describe('canJoinGroup', () => {
  it('accepts expenses, incomes, reimbursement paybacks and pending rows', () => {
    expect(canJoinGroup(item('a', 840, '2026-11-14'))).toBe(true)
    expect(canJoinGroup(item('b', -70, '2026-11-16'))).toBe(true)
    expect(canJoinGroup(item('c', -70, '2026-11-16', { isReimbursementIncome: true }))).toBe(true)
    expect(canJoinGroup(item('d', 12, '2026-11-16', { pending: true }))).toBe(true)
  })

  it('refuses transfer legs and swept outflows', () => {
    expect(canJoinGroup(item('t', 500, '2026-11-14', { transferId: 't1', transferKind: 'credit_card_payment', transferRole: 'expense' }))).toBe(false)
    expect(canJoinGroup(item('s', 50, '2026-11-14', { isSweptOutflow: true }))).toBe(false)
  })
})

describe('summarizeGroup', () => {
  const feed = new Map(
    [
      item('airbnb', 840, '2026-11-14'),
      item('gas', 96, '2026-11-15'),
      item('venmo', -70, '2026-11-16'),
      item('other', 5, '2026-11-16'),
    ].map((i) => [i.id, i]),
  )

  it('sums out and in from the members found, newest first', () => {
    const s = summarizeGroup(group('trip'), [member('trip', 'airbnb'), member('trip', 'gas'), member('trip', 'venmo'), member('x', 'other')], feed)
    expect(s.items.map((i) => i.id)).toEqual(['venmo', 'gas', 'airbnb'])
    expect(s.out).toBe(936)
    expect(s.in).toBe(70)
    expect(s.net).toBe(-866)
    expect(s.resolved).toBe(false)
  })

  it('skips members whose transaction is no longer in the feed', () => {
    const s = summarizeGroup(group('trip'), [member('trip', 'airbnb'), member('trip', 'gone')], feed)
    expect(s.items).toHaveLength(1)
    expect(s.out).toBe(840)
  })

  // The payback is its own row in the group; netting the expense too would count it twice.
  it('uses raw amounts, not the reimbursement-netted one', () => {
    const netted = new Map([
      ['airbnb', item('airbnb', 840, '2026-11-14', { reimbursedAmount: 210, netAmount: 630 })],
      ['venmo', item('venmo', -210, '2026-11-18', { isReimbursementIncome: true })],
    ])
    const s = summarizeGroup(group('trip'), [member('trip', 'airbnb'), member('trip', 'venmo')], netted)
    expect(s.net).toBe(-630)
  })
})

describe('hideActiveGroupMembers', () => {
  const items = [item('a', 10, '2026-11-14'), item('b', 10, '2026-11-15'), item('c', 10, '2026-11-15')]

  it('drops members of active groups and keeps resolved ones', () => {
    const groups = [group('active'), group('done', '2026-11-20T00:00:00Z')]
    const out = hideActiveGroupMembers(items, groups, [member('active', 'a'), member('done', 'b')])
    expect(out.map((i) => i.id)).toEqual(['b', 'c'])
  })

  it('returns the same array when nothing is hidden, so downstream memos hold', () => {
    expect(hideActiveGroupMembers(items, [], [])).toBe(items)
    expect(hideActiveGroupMembers(items, [group('done', '2026-11-20T00:00:00Z')], [member('done', 'a')])).toBe(items)
  })
})

describe('groupIdByItemId', () => {
  it('maps each member transaction to its group', () => {
    expect(groupIdByItemId([member('g1', 'a'), member('g2', 'm', true)])).toEqual(new Map([['a', 'g1'], ['m', 'g2']]))
  })
})

describe('nextGroupColor', () => {
  it('picks the first palette colour not already used', () => {
    expect(nextGroupColor([])).toBe(categoryColors.travel)
    expect(nextGroupColor([group('a', null, categoryColors.travel)])).toBe(categoryColors.foodAndDrink)
  })
})

describe('pickerCandidates', () => {
  const feed = [
    item('old', 7, '2026-11-01', { merchantName: 'Blue Bottle' }),
    item('new', 184, '2026-11-15', { merchantName: 'Safeway' }),
    item('mine', 96, '2026-11-15', { merchantName: 'Chevron' }),
    item('elsewhere', 96, '2026-11-22', { merchantName: 'Hungry Panda' }),
    item('xfer', 500, '2026-11-20', { transferId: 't', transferKind: 'credit_card_payment', transferRole: 'expense' }),
  ]
  const members = [member('trip', 'mine'), member('dinner', 'elsewhere')]

  it('lists eligible rows not in this group, newest first, flagging ones in another group', () => {
    const out = pickerCandidates(feed, 'trip', members, '')
    expect(out.map((c) => [c.item.id, c.otherGroupId])).toEqual([
      ['elsewhere', 'dinner'],
      ['new', null],
      ['old', null],
    ])
  })

  it('searches the shown name and the amount', () => {
    expect(pickerCandidates(feed, 'trip', members, 'safe').map((c) => c.item.id)).toEqual(['new'])
    expect(pickerCandidates(feed, 'trip', members, '$184').map((c) => c.item.id)).toEqual(['new'])
  })
})

describe('transactionCountLabel', () => {
  it('pluralises', () => {
    expect(transactionCountLabel(1)).toBe('1 transaction')
    expect(transactionCountLabel(7)).toBe('7 transactions')
  })
})
