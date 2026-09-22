import { describe, expect, it } from 'vitest'
import { countsTowardTotals, isInternalMovement, isInvestmentSweep, isTransfer, isUnlinkedInternalTransfer } from './totals'
import type { FeedItem } from './resolveFeed'

function item(overrides: Partial<FeedItem>): FeedItem {
  return {
    id: 'i1',
    source: 'plaid',
    amount: 100,
    date: '2026-08-10',
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
  }
}

/** A row on a brokerage cash account (Fidelity CMA and the like), where sweeps happen. */
function sweepItem(overrides: Partial<FeedItem>): FeedItem {
  return item({ isBrokerageCashAccount: true, ...overrides })
}

describe('isTransfer', () => {
  it('is true for either leg and false for an ordinary item', () => {
    expect(isTransfer(item({ transferKind: 'account_transfer', transferRole: 'expense' }))).toBe(true)
    expect(isTransfer(item({ transferKind: 'account_transfer', transferRole: 'income' }))).toBe(true)
    expect(isTransfer(item({}))).toBe(false)
  })
})

describe('countsTowardTotals', () => {
  it('counts an ordinary transaction', () => {
    expect(countsTowardTotals(item({}))).toBe(true)
  })

  it('skips a reimbursement income leg', () => {
    expect(countsTowardTotals(item({ isReimbursementIncome: true }))).toBe(false)
  })

  it('skips both legs of a transfer', () => {
    expect(countsTowardTotals(item({ transferKind: 'account_transfer', transferRole: 'expense' }))).toBe(false)
    expect(countsTowardTotals(item({ transferKind: 'account_transfer', transferRole: 'income' }))).toBe(false)
  })

  it('skips an unpaired transfer — the money still did not leave the user', () => {
    expect(countsTowardTotals(item({ transferKind: 'account_transfer', transferRole: 'expense' }))).toBe(false)
  })

  it('skips a credit card payment', () => {
    expect(countsTowardTotals(item({ transferKind: 'credit_card_payment', transferRole: 'expense' }))).toBe(false)
  })

  it('skips a cash-management sweep that has no transfer record', () => {
    expect(countsTowardTotals(sweepItem({ pfcDetailed: 'TRANSFER_OUT_INVESTMENT_AND_RETIREMENT_FUNDS' }))).toBe(false)
  })
})

// A brokerage cash account sweeps deposits into a fund, and Plaid reports the sweep as an outflow.
// Pairing can't rescue it either way: the counterpart is either an investment transaction (a
// different Plaid product, never in /transactions/sync) or — as Fidelity reports it — a second leg
// on the SAME account, which autoMatch's pairAllowed rejects. Hence the PFC route, and hence the
// scope: only on accounts where that's true, never on ordinary checking.
describe('isInternalMovement', () => {
  it('is true for an investment or retirement sweep in either direction', () => {
    expect(isInternalMovement(sweepItem({ pfcDetailed: 'TRANSFER_OUT_INVESTMENT_AND_RETIREMENT_FUNDS' }))).toBe(true)
    expect(isInternalMovement(sweepItem({ pfcDetailed: 'TRANSFER_IN_INVESTMENT_AND_RETIREMENT_FUNDS', amount: -500 }))).toBe(true)
  })

  it('is true for a savings sweep in either direction', () => {
    expect(isInternalMovement(sweepItem({ pfcDetailed: 'TRANSFER_OUT_SAVINGS' }))).toBe(true)
    expect(isInternalMovement(sweepItem({ pfcDetailed: 'TRANSFER_IN_SAVINGS', amount: -500 }))).toBe(true)
  })

  // The exclusion is scoped to accounts where pairing structurally can't work. On an ordinary
  // checking account the same code is left counted on purpose: autoMatch pairs it with a linked
  // counterpart (which sets transferKind), and an unpaired leg staying counted is the documented
  // bias — leave money counted rather than wrongly hide it.
  it('is false for the same codes on an ordinary checking account', () => {
    expect(isInternalMovement(item({ pfcDetailed: 'TRANSFER_OUT_INVESTMENT_AND_RETIREMENT_FUNDS' }))).toBe(false)
    expect(isInternalMovement(item({ pfcDetailed: 'TRANSFER_OUT_SAVINGS' }))).toBe(false)
    expect(isInternalMovement(item({ pfcDetailed: 'TRANSFER_IN_SAVINGS', amount: -500 }))).toBe(false)
  })

  // A brokerage redeems the core money-market position to fund what you spend from the cash
  // account, and tags the resulting inflow inconsistently: the same institution used
  // TRANSFER_IN_INVESTMENT_AND_RETIREMENT_FUNDS on some days and the generic account-transfer code
  // on others for the identical event. The generic code left the redemption looking like income.
  it('is true for a generic transfer-in on a brokerage cash account', () => {
    expect(isInternalMovement(sweepItem({ pfcDetailed: 'TRANSFER_IN_ACCOUNT_TRANSFER', amount: -4 }))).toBe(true)
    expect(countsTowardTotals(sweepItem({ pfcDetailed: 'TRANSFER_IN_ACCOUNT_TRANSFER', amount: -4 }))).toBe(false)
  })

  it('badges that redemption as an investment rather than leaving it bare', () => {
    expect(isInvestmentSweep(sweepItem({ pfcDetailed: 'TRANSFER_IN_ACCOUNT_TRANSFER', amount: -4 }))).toBe(true)
  })

  // IN only, deliberately. The outbound twin covers ACH rent and p2p payments made FROM the same
  // account, and hiding those understates spending — the dangerous direction. Hiding an inbound
  // leg understates income, and on a brokerage cash account a generic transfer-in is the user's
  // own money almost by definition.
  it('does not exclude the outbound twin, which covers real spending', () => {
    expect(isInternalMovement(sweepItem({ pfcDetailed: 'TRANSFER_OUT_ACCOUNT_TRANSFER' }))).toBe(false)
  })

  it('leaves a generic transfer-in on an ordinary checking account counted', () => {
    expect(isInternalMovement(item({ pfcDetailed: 'TRANSFER_IN_ACCOUNT_TRANSFER', amount: -4 }))).toBe(false)
  })

  it('still excludes a paired transfer on a checking account, via its transfer record', () => {
    expect(isInternalMovement(item({ pfcDetailed: 'TRANSFER_OUT_SAVINGS', transferKind: 'account_transfer', transferRole: 'expense' }))).toBe(true)
  })

  it('still covers anything carrying a transfer record, whatever its PFC', () => {
    expect(isInternalMovement(item({ transferKind: 'credit_card_payment', transferRole: 'expense' }))).toBe(true)
    expect(isInternalMovement(item({ transferKind: 'account_transfer', transferRole: 'income' }))).toBe(true)
  })

  // An unlinked card's payment is the only visible proxy for the purchases made on that card,
  // so excluding it by PFC would make spend totals under-count. Pairing handles the linked
  // case (autoMatch's CC_PAYMENT_CODE driver), and that path sets transferKind.
  it('does not exclude a credit card payment on PFC alone', () => {
    expect(isInternalMovement(item({ pfcDetailed: 'LOAN_PAYMENTS_CREDIT_CARD_PAYMENT' }))).toBe(false)
  })

  // Plaid: "Cash, checks, and ATM deposits into a bank account" — arriving from outside.
  it('does not exclude a deposit', () => {
    expect(isInternalMovement(item({ pfcDetailed: 'TRANSFER_IN_DEPOSIT', amount: -2400 }))).toBe(false)
  })

  it('does not exclude a cash withdrawal, which gets spent later', () => {
    expect(isInternalMovement(item({ pfcDetailed: 'TRANSFER_OUT_WITHDRAWAL' }))).toBe(false)
  })

  // Left out deliberately. Plaid's taxonomy has no peer-to-peer code, so Venmo/Zelle to a person
  // lands on the generic account-transfer code alongside genuine internal moves — as does ACH
  // rent. Excluding it wholesale would hide real spending.
  it('does not exclude a generic account transfer without a transfer record', () => {
    expect(isInternalMovement(item({ pfcDetailed: 'TRANSFER_OUT_ACCOUNT_TRANSFER' }))).toBe(false)
    expect(isInternalMovement(item({ pfcDetailed: 'TRANSFER_IN_ACCOUNT_TRANSFER', amount: -50 }))).toBe(false)
  })

  it('is false for an ordinary item and for a manual transaction with no PFC', () => {
    expect(isInternalMovement(item({}))).toBe(false)
    expect(isInternalMovement(item({ source: 'manual', pfcDetailed: null }))).toBe(false)
  })
})

// The other half of isInvestmentSweep's job: a row it stopped claiming still greys out, and a
// greyed row with no badge is the exact confusion the "Investment" pill was added to prevent.
describe('isUnlinkedInternalTransfer', () => {
  it('is true for an excluded brokerage-cash row with a counterpart on another account', () => {
    const row = sweepItem({
      pfcDetailed: 'TRANSFER_OUT_INVESTMENT_AND_RETIREMENT_FUNDS',
      hasCrossAccountCounterpart: true,
    })
    expect(isUnlinkedInternalTransfer(row)).toBe(true)
    expect(isInvestmentSweep(row)).toBe(false)
  })

  it('is false once the pair is a real transfer, which carries its own badge', () => {
    const row = sweepItem({
      pfcDetailed: 'TRANSFER_OUT_INVESTMENT_AND_RETIREMENT_FUNDS',
      hasCrossAccountCounterpart: true,
      transferKind: 'account_transfer',
      transferRole: 'expense',
    })
    expect(isUnlinkedInternalTransfer(row)).toBe(false)
  })

  // A cross-account counterpart is not on its own a reason to grey anything out — autoMatch is
  // what decides that, and until it does the money stays counted and unbadged.
  it('is false for a row that still counts toward totals', () => {
    const row = sweepItem({ pfcDetailed: 'TRANSFER_OUT_ACCOUNT_TRANSFER', hasCrossAccountCounterpart: true })
    expect(countsTowardTotals(row)).toBe(true)
    expect(isUnlinkedInternalTransfer(row)).toBe(false)
  })

  // A pending row is already excluded — by not having settled, not by being internal. Claiming it
  // as internal movement steals the "Pending" label, which is the one that actually explains the
  // greying, and asserts a classification the bank hasn't confirmed yet.
  it('is false for a pending row, whose own label explains the greying', () => {
    const row = sweepItem({ pending: true, hasCrossAccountCounterpart: true })
    expect(countsTowardTotals(row)).toBe(false)
    expect(isUnlinkedInternalTransfer(row)).toBe(false)
  })

  it('is false for a genuine sweep, which the Investment pill already explains', () => {
    expect(isUnlinkedInternalTransfer(sweepItem({ isSweptOutflow: true }))).toBe(false)
  })
})

// Drives the "Investment" pill. Scoped to rows that are greyed out with nothing else on them to
// explain why — transfer legs already carry a badge, reimbursement legs an icon and a title.
describe('isInvestmentSweep', () => {
  it('is true for an outflow the sweep pass matched', () => {
    expect(isInvestmentSweep(sweepItem({ isSweptOutflow: true, pfcDetailed: 'TRANSFER_OUT_ACCOUNT_TRANSFER' }))).toBe(true)
  })

  it('is true for a brokerage-cash row excluded on its PFC code alone', () => {
    expect(isInvestmentSweep(sweepItem({ pfcDetailed: 'TRANSFER_OUT_INVESTMENT_AND_RETIREMENT_FUNDS' }))).toBe(true)
  })

  // An outflow from a brokerage cash account to a linked bank carries the brokerage's own
  // investment code, so the PFC branch excludes it — correctly, it is internal movement. Calling it
  // an investment is the lie: the money went to a bank, and the leg proving it is sitting in the
  // feed waiting to be paired.
  it('is false for an excluded row whose counterpart sits on another account', () => {
    const row = sweepItem({
      pfcDetailed: 'TRANSFER_OUT_INVESTMENT_AND_RETIREMENT_FUNDS',
      hasCrossAccountCounterpart: true,
    })
    expect(isInvestmentSweep(row)).toBe(false)
    // Still not spending — it moved between the user's own accounts.
    expect(countsTowardTotals(row)).toBe(false)
  })

  it('is false for a transfer leg, which already has its own badge', () => {
    expect(isInvestmentSweep(item({ transferKind: 'account_transfer', transferRole: 'expense' }))).toBe(false)
    expect(isInvestmentSweep(sweepItem({ transferKind: 'account_transfer', transferRole: 'expense', pfcDetailed: 'TRANSFER_OUT_SAVINGS' }))).toBe(false)
  })

  it('is false for a reimbursement income leg, which has its own icon and title', () => {
    expect(isInvestmentSweep(item({ isReimbursementIncome: true }))).toBe(false)
  })

  it('is false for the income leg of a sweep pair, which still counts', () => {
    expect(isInvestmentSweep(sweepItem({ amount: -2928.85, pfcDetailed: 'INCOME_SALARY' }))).toBe(false)
  })

  it('is false for an ordinary counted transaction', () => {
    expect(isInvestmentSweep(item({}))).toBe(false)
    expect(isInvestmentSweep(item({ pfcDetailed: 'FOOD_AND_DRINK_GROCERIES' }))).toBe(false)
  })

  // Everything it flags must also be excluded, or the pill would claim a row that still counts.
  it('never flags anything that counts toward totals', () => {
    const flagged = [
      sweepItem({ isSweptOutflow: true }),
      sweepItem({ pfcDetailed: 'TRANSFER_OUT_SAVINGS' }),
    ]
    for (const row of flagged) {
      expect(isInvestmentSweep(row)).toBe(true)
      expect(countsTowardTotals(row)).toBe(false)
    }
  })
})

describe('investment-source items in totals', () => {
  const investmentItem = (over: Partial<FeedItem> = {}): FeedItem =>
    item({
      id: 'itx-1',
      source: 'investment',
      accountId: 'acc-ira',
      isBrokerageCashAccount: true,
      amount: -1000,
      ...over,
    })

  it('counts an unpaired contribution', () => {
    expect(countsTowardTotals(investmentItem())).toBe(true)
  })

  it('counts a small household-money amount too — nothing here is thresholded', () => {
    expect(countsTowardTotals(investmentItem({ amount: -12.5 }))).toBe(true)
  })


  it('excludes a paired contribution — the transfer record already covers it', () => {
    const paired = investmentItem({ transferKind: 'account_transfer', transferRole: 'income' })
    expect(countsTowardTotals(paired)).toBe(false)
  })


  it('does not badge a counted contribution', () => {
    expect(isInvestmentSweep(investmentItem())).toBe(false)
  })

  it('leaves ordinary plaid spending counted', () => {
    expect(countsTowardTotals(item({ source: 'plaid', amount: 42 }))).toBe(true)
  })
})

describe('pending exclusion', () => {
  it('a pending transaction is visible in the feed but counts toward nothing', () => {
    const pendingExpense = item({ id: 'p1', amount: 42, pending: true })
    expect(countsTowardTotals(pendingExpense)).toBe(false)
  })

  it('the same transaction counts once it posts', () => {
    const posted = item({ id: 'p2', amount: 42, pending: false })
    expect(countsTowardTotals(posted)).toBe(true)
  })
})
