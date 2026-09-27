import { describe, expect, it } from 'vitest'
import { computeAccountHistory, computeNetWorthHistory, netWorthFromAccounts, netWorthYearRange } from './netWorthHistory'
import { CASH_ON_HAND_KEY } from './composition'
import type { FeedItem } from '@/lib/transactions/resolveFeed'

const TODAY = new Date('2026-08-05T12:00:00Z')
const LINKED = new Set(['checking', 'card'])

function txn(overrides: Partial<FeedItem> & { date: string; amount: number }): FeedItem {
  return {
    id: `${overrides.date}-${overrides.amount}`,
    source: 'plaid',
    merchantName: 'Test',
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
    // Tracks `date`: these cases care about the display/bucketing date, and letting the
    // two drift would quietly change what any proximity assertion means.
    postedDate: overrides.postedDate ?? overrides.date,
  }
}

describe('computeNetWorthHistory', () => {
  it('walks backwards from the current balance, undoing each month of activity', () => {
    // Net worth is 1000 today. July spent 200 net, June earned 500 net.
    const feed = [
      txn({ date: '2026-07-15', amount: 200 }),
      txn({ date: '2026-06-10', amount: -500 }),
    ]
    const points = computeNetWorthHistory(1000, feed, LINKED, 2026, TODAY)

    expect(points.map((p) => [p.month, p.netWorth, p.change])).toEqual([
      [6, 1200, 500], // June ended at 1200 after +500
      [7, 1000, -200], // July's 200 of spending took it to 1000
      [8, 1000, 0], // August has no activity yet
    ])
  })

  it('treats money leaving an account as a net worth decrease regardless of account type', () => {
    // A card payment: 50 out of checking, 50 off the card balance. Net worth is unchanged,
    // so the previous month must land on the same value as today.
    const feed = [
      txn({ date: '2026-07-20', amount: 50, accountId: 'checking' }),
      txn({ date: '2026-07-20', amount: -50, accountId: 'card', id: 'card-payment' }),
    ]
    const points = computeNetWorthHistory(-250.37, feed, LINKED, 2026, TODAY)

    expect(points.find((p) => p.month === 7)?.netWorth).toBe(-250.37)
    expect(points.find((p) => p.month === 7)?.change).toBe(0)
  })

  it('counts manual transactions, anchoring the cash they moved on today', () => {
    // A $300 cash expense in July reads as "that money was still on hand in June" — it lifts
    // the earlier value rather than today's, which stays pinned to real balances. The June
    // Plaid deposit is only here to pull the walk back far enough to show June.
    const feed = [
      txn({ date: '2026-07-01', amount: 300, accountId: null, source: 'manual' }),
      txn({ date: '2026-06-01', amount: -500 }),
    ]
    const points = computeNetWorthHistory(1000, feed, LINKED, 2026, TODAY)

    expect(points.map((p) => [p.month, p.netWorth, p.change])).toEqual([
      [6, 1300, 500],
      [7, 1000, -300], // the manual expense, and nothing else, moved July
      [8, 1000, 0],
    ])
  })

  it('drops Plaid transactions whose account is no longer linked', () => {
    const feed = [txn({ date: '2026-07-02', amount: 400, accountId: 'unlinked-account' })]
    const points = computeNetWorthHistory(1000, feed, LINKED, 2026, TODAY)

    expect(points.every((p) => p.change === 0)).toBe(true)
    expect(points.every((p) => p.netWorth === 1000)).toBe(true)
  })

  it('omits months earlier than the oldest synced transaction rather than flat-lining them', () => {
    const feed = [txn({ date: '2026-05-10', amount: 100 })]
    const points = computeNetWorthHistory(900, feed, LINKED, 2026, TODAY)

    expect(points.map((p) => p.month)).toEqual([5, 6, 7, 8])
  })

  it('carries the walk across a year boundary and returns only the requested year', () => {
    const feed = [
      txn({ date: '2026-03-01', amount: 100 }),
      txn({ date: '2025-11-01', amount: -400 }),
    ]

    const y2026 = computeNetWorthHistory(1000, feed, LINKED, 2026, TODAY)
    expect(y2026[0]).toMatchObject({ month: 1, netWorth: 1100 })

    const y2025 = computeNetWorthHistory(1000, feed, LINKED, 2025, TODAY)
    expect(y2025.map((p) => [p.month, p.netWorth])).toEqual([
      [11, 1100],
      [12, 1100],
    ])
  })

  it('returns nothing for years outside the reconstructable range', () => {
    const feed = [txn({ date: '2026-06-01', amount: 100 })]
    expect(computeNetWorthHistory(1000, feed, LINKED, 2027, TODAY)).toEqual([])
    expect(computeNetWorthHistory(1000, feed, LINKED, 2024, TODAY)).toEqual([])
  })

  it('still reports the current month when there is no transaction history at all', () => {
    const points = computeNetWorthHistory(500, [], LINKED, 2026, TODAY)
    expect(points).toEqual([{ year: 2026, month: 8, netWorth: 500, change: 0 }])
  })

  it('rounds to cents so repeated subtraction does not leak float noise', () => {
    const feed = [
      txn({ date: '2026-07-01', amount: 0.1 }),
      txn({ date: '2026-06-01', amount: 0.2 }),
    ]
    for (const point of computeNetWorthHistory(10, feed, LINKED, 2026, TODAY)) {
      expect(point.netWorth).toBe(Number(point.netWorth.toFixed(2)))
      expect(point.change).toBe(Number(point.change.toFixed(2)))
    }
  })
})

describe('netWorthYearRange', () => {
  it('spans the oldest synced transaction through the current year', () => {
    const feed = [txn({ date: '2024-02-01', amount: 10 }), txn({ date: '2026-01-01', amount: 10 })]
    expect(netWorthYearRange(feed, LINKED, TODAY)).toEqual({ first: 2024, last: 2026 })
  })

  it('extends back to the oldest manual transaction too', () => {
    const feed = [txn({ date: '2023-05-01', amount: 10, accountId: null, source: 'manual' })]
    expect(netWorthYearRange(feed, LINKED, TODAY)).toEqual({ first: 2023, last: 2026 })
  })

  it('collapses to the current year when nothing is reconstructable', () => {
    expect(netWorthYearRange([], LINKED, TODAY)).toEqual({ first: 2026, last: 2026 })
    expect(netWorthYearRange([txn({ date: '2024-02-01', amount: 10, accountId: 'unlinked' })], LINKED, TODAY)).toEqual({
      first: 2026,
      last: 2026,
    })
  })
})

describe('computeNetWorthHistory: investment-source rows', () => {
  const LINKED_WITH_IRA = new Set(['checking', 'card', 'ira'])
  const investment = (overrides: Partial<FeedItem> & { date: string; amount: number }): FeedItem =>
    txn({ source: 'investment', accountId: 'ira', isBrokerageCashAccount: true, ...overrides })

  // Every case carries a $50 July grocery as an anchor: it keeps July inside the walk (a month
  // with no counted flow at all is omitted rather than flat-lined) and gives the assertions a
  // known non-zero baseline, so "this row contributed nothing" is visible as -50.
  const anchor = txn({ date: '2026-07-20', amount: 50, accountId: 'checking' })


  it('cancels a contribution against its checking leg — both legs now exist', () => {
    // Both legs present: the checking outflow (+1000) and the investment-side arrival (-1000)
    // sum to zero, which is correct and better than counting the checking leg alone.
    const points = computeNetWorthHistory(
      50_000,
      [
        anchor,
        txn({ date: '2026-07-15', amount: 1000, accountId: 'checking' }),
        investment({ date: '2026-07-15', amount: -1000 }),
      ],
      LINKED_WITH_IRA,
      2026,
      TODAY,
    )
    expect(points.find((p) => p.month === 7)!.change).toBe(-50)
  })

  it('still counts an unpaired investment inflow, which really did add value', () => {
    const points = computeNetWorthHistory(
      50_000,
      [anchor, investment({ date: '2026-07-15', amount: -120 })],
      LINKED_WITH_IRA,
      2026,
      TODAY,
    )
    expect(points.find((p) => p.month === 7)!.change).toBe(70)
  })

  it('drops household money on an account that is no longer linked', () => {
    // Same rationale as the plaid case: that balance left the net worth total when the
    // institution was removed, so unwinding its history unwinds a phantom.
    const points = computeNetWorthHistory(
      50_000,
      [anchor, investment({ date: '2026-07-15', amount: -1000 })],
      LINKED,
      2026,
      TODAY,
    )
    expect(points.find((p) => p.month === 7)!.change).toBe(-50)
  })
})

describe('computeNetWorthHistory: movement that never changed net worth', () => {
  const LINKED_WITH_CMA = new Set(['checking', 'card', 'cma'])
  const cma = (overrides: Partial<FeedItem> & { date: string; amount: number }): FeedItem =>
    txn({ accountId: 'cma', isBrokerageCashAccount: true, ...overrides })

  // Same role as the investment block's anchor: keeps July in the walk with a known baseline,
  // so "this row contributed nothing" reads as -50.
  const anchor = txn({ date: '2026-07-20', amount: 50, accountId: 'checking', id: 'anchor' })

  const julyChange = (feed: FeedItem[]) =>
    computeNetWorthHistory(50_000, [anchor, ...feed], LINKED_WITH_CMA, 2026, TODAY).find((p) => p.month === 7)!.change

  it('drops a sweep into holdings — its counterpart is an investment trade the feed never sees', () => {
    // Checking funds the cash account (a paired transfer), then the cash account sweeps it into
    // holdings. The money is all still there; only the sweep's missing other half made it dip.
    const change = julyChange([
      txn({ id: 'out', date: '2026-07-10', amount: 2000, accountId: 'checking', transferKind: 'account_transfer' }),
      cma({ id: 'in', date: '2026-07-10', amount: -2000, transferKind: 'account_transfer' }),
      cma({ id: 'sweep', date: '2026-07-11', amount: 2000, pfcDetailed: 'TRANSFER_OUT_ACCOUNT_TRANSFER', isSweptOutflow: true }),
    ])
    expect(change).toBe(-50)
  })

  it('drops an unpaired internal movement on a brokerage cash account with no counterpart anywhere', () => {
    const change = julyChange([
      cma({ date: '2026-07-11', amount: 1500, pfcDetailed: 'TRANSFER_OUT_INVESTMENT_AND_RETIREMENT_FUNDS' }),
    ])
    expect(change).toBe(-50)
  })

  it('drops a core-fund redemption but keeps the bill it was raised to pay', () => {
    const change = julyChange([
      cma({ id: 'redeem', date: '2026-07-12', amount: -300, pfcDetailed: 'TRANSFER_IN_ACCOUNT_TRANSFER' }),
      cma({ id: 'bill', date: '2026-07-12', amount: 300, pfcDetailed: 'RENT_AND_UTILITIES_GAS_AND_ELECTRICITY' }),
    ])
    expect(change).toBe(-350)
  })

  it('keeps an unpaired internal inflow whose outflow sits on another linked account, so the two cancel', () => {
    // Checking's generic outbound code counts everywhere; dropping only the arrival would leave a
    // phantom $800 loss.
    const change = julyChange([
      txn({ id: 'out', date: '2026-07-08', amount: 800, accountId: 'checking', pfcDetailed: 'TRANSFER_OUT_ACCOUNT_TRANSFER' }),
      cma({ id: 'in', date: '2026-07-10', amount: -800, pfcDetailed: 'TRANSFER_IN_ACCOUNT_TRANSFER' }),
    ])
    expect(change).toBe(-50)
  })

  it('keeps an unpaired internal outflow whose arrival sits on another linked account', () => {
    const change = julyChange([
      cma({ id: 'out', date: '2026-07-08', amount: 800, pfcDetailed: 'TRANSFER_OUT_INVESTMENT_AND_RETIREMENT_FUNDS' }),
      txn({ id: 'in', date: '2026-07-09', amount: -800, accountId: 'checking' }),
    ])
    expect(change).toBe(-50)
  })

  it('still counts a dividend that was swept straight into holdings', () => {
    const change = julyChange([
      cma({ id: 'div', date: '2026-07-15', amount: -40, pfcDetailed: 'INCOME_DIVIDENDS' }),
      cma({ id: 'sweep', date: '2026-07-15', amount: 40, pfcDetailed: 'TRANSFER_OUT_ACCOUNT_TRANSFER', isSweptOutflow: true }),
    ])
    expect(change).toBe(-10)
  })

  it('keeps both legs of a paired transfer, which is what makes them cancel', () => {
    const change = julyChange([
      cma({ id: 'out', date: '2026-07-08', amount: 500, pfcDetailed: 'TRANSFER_OUT_SAVINGS', transferKind: 'account_transfer' }),
      txn({ id: 'in', date: '2026-07-08', amount: -500, accountId: 'checking', transferKind: 'account_transfer' }),
    ])
    expect(change).toBe(-50)
  })

  it('skips pending rows — today’s anchor is the settled balance, which does not include them yet', () => {
    const change = julyChange([txn({ date: '2026-07-30', amount: 90, pending: true })])
    expect(change).toBe(-50)
  })
})

describe('computeAccountHistory', () => {
  const LINKED_ALL = new Set(['checking', 'card', 'brokerage'])
  // Signed the way net worth reads them: the card's $400 owed is -400.
  const anchors = new Map([
    ['checking', 5000],
    ['card', -400],
    ['brokerage', 20_000],
    [CASH_ON_HAND_KEY, 60],
  ])

  const feed = [
    txn({ id: 'rent', date: '2026-07-01', amount: 1500, accountId: 'checking' }),
    txn({ id: 'pay', date: '2026-07-15', amount: -3000, accountId: 'checking' }),
    txn({ id: 'groceries', date: '2026-07-18', amount: 250, accountId: 'card' }),
    txn({ id: 'card-pay-out', date: '2026-06-28', amount: 600, accountId: 'checking', transferKind: 'credit_card_payment' }),
    txn({ id: 'card-pay-in', date: '2026-06-28', amount: -600, accountId: 'card', transferKind: 'credit_card_payment' }),
    // Only pulls May into the walk; it lands in May, so May's end balance already includes it.
    txn({ id: 'coffee', date: '2026-05-10', amount: 10, accountId: 'checking' }),
    txn({ id: 'wallet', date: '2026-07-04', amount: 40, accountId: null, source: 'manual' }),
    txn({
      id: 'sweep',
      date: '2026-07-20',
      amount: 1000,
      accountId: 'brokerage',
      isBrokerageCashAccount: true,
      pfcDetailed: 'TRANSFER_OUT_INVESTMENT_AND_RETIREMENT_FUNDS',
    }),
  ]

  const history = computeAccountHistory(anchors, feed, LINKED_ALL, 2026, TODAY)
  const at = (month: number) => history.find((p) => p.month === month)!.balances

  it('walks each account back on its own, liabilities included', () => {
    // End of June: rent un-spent and pay un-earned on checking; groceries un-charged on the card.
    expect(at(6).get('checking')).toBe(5000 + 1500 - 3000)
    expect(at(6).get('card')).toBe(-400 + 250)
    // End of May: the card payment is undone on both sides.
    expect(at(5).get('checking')).toBe(5000 + 1500 - 3000 + 600)
    expect(at(5).get('card')).toBe(-400 + 250 - 600)
  })

  it('puts manual transactions on the cash-on-hand row', () => {
    expect(at(6).get(CASH_ON_HAND_KEY)).toBe(100)
  })

  it('leaves a sweep into holdings out, so the investment account stays flat', () => {
    expect(at(6).get('brokerage')).toBe(20_000)
  })

  it('adds up to computeNetWorthHistory every month', () => {
    const total = [...anchors.values()].reduce((sum, v) => sum + v, 0)
    const expected = computeNetWorthHistory(total, feed, LINKED_ALL, 2026, TODAY)
    expect(history.map((p) => [p.year, p.month])).toEqual(expected.map((p) => [p.year, p.month]))
    history.forEach((point, i) => {
      const sum = [...point.balances.values()].reduce((s, v) => s + v, 0)
      expect(Math.round(sum * 100) / 100).toBe(expected[i].netWorth)
    })
  })
})


describe('computeAccountHistory: accounts that did not exist yet', () => {
  const LINKED_NEW = new Set(['checking', 'cma', 'card'])
  // The cash account's first activity is in June. Undoing everything from June on leaves -150:
  // a balance no cash account can have, so before June it did not exist.
  const feed = [
    txn({ id: 'jan', date: '2026-01-05', amount: 20, accountId: 'checking' }),
    txn({ id: 'open', date: '2026-06-03', amount: -500, accountId: 'cma' }),
    txn({ id: 'jul', date: '2026-07-10', amount: -150, accountId: 'cma' }),
    txn({ id: 'card-first', date: '2026-04-02', amount: 80, accountId: 'card' }),
  ]
  const expectedSign = new Map<string, 1 | -1>([
    ['cma', 1],
    ['card', -1],
  ])
  const at = (history: ReturnType<typeof computeAccountHistory>, month: number, key: string) =>
    history.find((p) => p.month === month)!.balances.get(key)

  it('shows an impossible pre-history balance as zero — the account did not exist', () => {
    // cma today 500: undo July (+150 in) → 350 at end of June, undo June (+500 in) → -150.
    const history = computeAccountHistory(
      new Map([['checking', 1000], ['cma', 500], ['card', 0]]),
      feed,
      LINKED_NEW,
      2026,
      TODAY,
      { expectedSign },
    )
    expect(at(history, 5, 'cma')).toBe(0)
    expect(at(history, 1, 'cma')).toBe(0)
    expect(at(history, 6, 'cma')).toBe(350)
    expect(history.find((p) => p.month === 6)!.startBalances.get('cma')).toBe(0)
  })

  it('keeps a possible pre-history balance — an account older than the history looks like this', () => {
    const history = computeAccountHistory(new Map([['checking', 1000], ['cma', 900], ['card', 0]]), feed, LINKED_NEW, 2026, TODAY, {
      expectedSign,
    })
    expect(at(history, 5, 'cma')).toBe(250)
  })

  it('applies the reverse rule to debt: a card in credit before its first activity did not exist', () => {
    // Owes nothing today; undoing its first $80 charge would leave the card $80 in credit.
    const history = computeAccountHistory(new Map([['checking', 1000], ['cma', 500], ['card', 0]]), feed, LINKED_NEW, 2026, TODAY, {
      expectedSign,
    })
    expect(at(history, 3, 'card')).toBe(0)
    const owed = computeAccountHistory(new Map([['checking', 1000], ['cma', 500], ['card', -200]]), feed, LINKED_NEW, 2026, TODAY, {
      expectedSign,
    })
    expect(at(owed, 3, 'card')).toBe(-120)
  })

  it('leaves every account alone without expectedSign', () => {
    const history = computeAccountHistory(new Map([['checking', 1000], ['cma', 500], ['card', 0]]), feed, LINKED_NEW, 2026, TODAY)
    expect(at(history, 5, 'cma')).toBe(-150)
  })

  it('builds a net worth line that includes the jump when an account appears', () => {
    const history = computeAccountHistory(new Map([['checking', 1000], ['cma', 500], ['card', 0]]), feed, LINKED_NEW, 2026, TODAY, {
      expectedSign,
    })
    const line = netWorthFromAccounts(history)
    line.forEach((point, i) => {
      const sum = [...history[i].balances.values()].reduce((s, v) => s + v, 0)
      expect(point.netWorth).toBe(Math.round(sum * 100) / 100)
      if (i > 0) expect(point.change).toBe(Math.round((point.netWorth - line[i - 1].netWorth) * 100) / 100)
    })
  })
})
