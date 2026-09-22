import { describe, expect, it } from 'vitest'
import { detectTransfers } from './autoMatch'
import type { FeedItem } from '@/lib/transactions/resolveFeed'
import type { Account } from '@/types/domain'

// Accounts: two depositories, one credit card, one loan.
const accounts = [
  { account_id: 'checking', type: 'depository' },
  { account_id: 'savings', type: 'depository' },
  { account_id: 'visa', type: 'credit' },
  { account_id: 'mortgage', type: 'loan' },
] as unknown as Account[]

function item(overrides: Partial<FeedItem> & Pick<FeedItem, 'id' | 'amount' | 'date'>): FeedItem {
  return {
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
  }
}

// The canonical pair: tagged $500 payment out of checking, $500 landing on the visa.
const paymentOut = item({
  id: 'pay-out', amount: 500, date: '2026-08-01',
  accountId: 'checking', pfcDetailed: 'LOAN_PAYMENTS_CREDIT_CARD_PAYMENT',
})
const paymentIn = item({ id: 'pay-in', amount: -500, date: '2026-08-03', accountId: 'visa' })

function detect(feed: FeedItem[], extra?: { deltaIds?: Set<string> | null; dismissedIds?: Set<string> }) {
  return detectTransfers({ feed, accounts, ...extra })
}

describe('detectTransfers: credit-card payments', () => {
  it('auto-applies a uniquely matched card payment and orients the legs', () => {
    const { autoApply, suggestions } = detect([paymentOut, paymentIn])
    expect(suggestions).toEqual([])
    expect(autoApply).toHaveLength(1)
    expect(autoApply[0]).toMatchObject({
      kind: 'credit_card_payment',
      expense: { id: 'pay-out' },
      income: { id: 'pay-in' },
      amount: 500,
    })
  })

  it('reconciles through the delta: a tagged card inflow drives and finds an old untagged outflow', () => {
    // Card linked later: the delta is the card's history; the months-old checking outflow
    // is already in the cache and carries no transfer tag at all.
    const oldOutflow = item({ id: 'old-out', amount: 500, date: '2026-08-01', accountId: 'checking' })
    const cardInflow = item({
      id: 'card-in', amount: -500, date: '2026-08-03', accountId: 'visa',
      pfcDetailed: 'LOAN_PAYMENTS_CREDIT_CARD_PAYMENT',
    })
    const { autoApply } = detect([oldOutflow, cardInflow], { deltaIds: new Set(['card-in']) })
    expect(autoApply).toHaveLength(1)
    expect(autoApply[0]).toMatchObject({ kind: 'credit_card_payment', expense: { id: 'old-out' }, income: { id: 'card-in' } })
  })

  it('suggests instead of auto-applying when two credit inflows are candidates, defaulting to the nearest date', () => {
    const near = item({ id: 'in-near', amount: -500, date: '2026-08-02', accountId: 'visa' })
    const far = item({ id: 'in-far', amount: -500, date: '2026-08-06', accountId: 'visa' })
    const { autoApply, suggestions } = detect([paymentOut, near, far])
    expect(autoApply).toEqual([])
    expect(suggestions).toHaveLength(1)
    expect(suggestions[0].income.id).toBe('in-near')
  })

  it('suggests instead of auto-applying when the reverse direction is ambiguous', () => {
    // One credit inflow, but TWO same-amount outflows in the window — either could be the
    // payment. A one-directional check would silently pick whichever drove first.
    const otherOut = item({ id: 'rent-out', amount: 500, date: '2026-08-02', accountId: 'savings' })
    const { autoApply, suggestions } = detect([paymentOut, otherOut, paymentIn])
    expect(autoApply).toEqual([])
    expect(suggestions.length).toBeGreaterThan(0)
  })

  it('leaves an unmatched payment counted when no credit counterpart exists (card not linked)', () => {
    const { autoApply, suggestions } = detect([paymentOut])
    expect(autoApply).toEqual([])
    expect(suggestions).toEqual([])
  })

  it('produces one draft when both legs arrive in the same delta and drive from both sides', () => {
    const taggedIn = item({ ...paymentIn, pfcDetailed: 'LOAN_PAYMENTS_CREDIT_CARD_PAYMENT' })
    const { autoApply, suggestions } = detect([paymentOut, taggedIn], { deltaIds: new Set(['pay-out', 'pay-in']) })
    expect(autoApply).toHaveLength(1)
    expect(suggestions).toEqual([])
  })

  it('only suggests for an untagged credit-account inflow (weak driver), never auto-applies', () => {
    const untaggedOut = item({ id: 'old-out', amount: 500, date: '2026-08-01', accountId: 'checking' })
    const { autoApply, suggestions } = detect([untaggedOut, paymentIn], { deltaIds: new Set(['pay-in']) })
    expect(autoApply).toEqual([])
    expect(suggestions).toHaveLength(1)
    expect(suggestions[0]).toMatchObject({ kind: 'credit_card_payment', expense: { id: 'old-out' } })
  })

  it('never pairs a loan-account inflow: a mortgage payment is real spending', () => {
    const mortgagePayment = item({
      id: 'mort-out', amount: 2000, date: '2026-08-01',
      pfcDetailed: 'LOAN_PAYMENTS_CREDIT_CARD_PAYMENT', // even mis-tagged by Plaid
    })
    const mortgageIn = item({ id: 'mort-in', amount: -2000, date: '2026-08-02', accountId: 'mortgage' })
    const { autoApply, suggestions } = detect([mortgagePayment, mortgageIn])
    expect(autoApply).toEqual([])
    expect(suggestions).toEqual([])
  })
})

describe('detectTransfers: account transfers', () => {
  const transferOut = item({
    id: 'xfer-out', amount: 1000, date: '2026-08-01',
    accountId: 'checking', pfcDetailed: 'TRANSFER_OUT_ACCOUNT_TRANSFER',
  })
  const transferIn = item({ id: 'xfer-in', amount: -1000, date: '2026-08-02', accountId: 'savings' })

  it('auto-applies an exact-tagged transfer to an untagged depository inflow', () => {
    const { autoApply, suggestions } = detect([transferOut, transferIn])
    expect(suggestions).toEqual([])
    expect(autoApply).toHaveLength(1)
    expect(autoApply[0]).toMatchObject({ kind: 'account_transfer', expense: { id: 'xfer-out' }, income: { id: 'xfer-in' } })
  })

  it('auto-applies when the tagged inflow drives against an untagged outflow', () => {
    const untaggedOut = item({ id: 'out', amount: 1000, date: '2026-08-01', accountId: 'checking' })
    const taggedIn = item({
      id: 'in', amount: -1000, date: '2026-08-02', accountId: 'savings',
      pfcDetailed: 'TRANSFER_IN_ACCOUNT_TRANSFER',
    })
    const { autoApply } = detect([untaggedOut, taggedIn], { deltaIds: new Set(['in']) })
    expect(autoApply).toHaveLength(1)
    expect(autoApply[0]).toMatchObject({ kind: 'account_transfer' })
  })

  it('never pairs against real income: a dividend is not a transfer leg', () => {
    const dividend = item({
      id: 'div', amount: -1000, date: '2026-08-02', accountId: 'savings',
      pfcDetailed: 'INCOME_DIVIDENDS',
    })
    const { autoApply, suggestions } = detect([transferOut, dividend])
    expect(autoApply).toEqual([])
    expect(suggestions).toEqual([])
  })

  it('treats P2P as a weak driver: suggestion only, even with a unique counterpart', () => {
    const venmoOut = item({
      id: 'venmo', amount: 75, date: '2026-08-01',
      accountId: 'checking', pfcDetailed: 'TRANSFER_OUT_PEER_TO_PEER_PAYMENT',
    })
    const inflow = item({ id: 'in', amount: -75, date: '2026-08-01', accountId: 'savings' })
    const { autoApply, suggestions } = detect([venmoOut, inflow])
    expect(autoApply).toEqual([])
    expect(suggestions).toHaveLength(1)
  })

  it('derives credit_card_payment kind when a generic TRANSFER_OUT lands on a credit account', () => {
    const genericOut = item({
      id: 'out', amount: 300, date: '2026-08-01',
      accountId: 'checking', pfcDetailed: 'TRANSFER_OUT_OTHER_TRANSFER_OUT',
    })
    const cardIn = item({ id: 'in', amount: -300, date: '2026-08-02', accountId: 'visa' })
    const { autoApply, suggestions } = detect([genericOut, cardIn])
    expect(autoApply).toEqual([])
    expect(suggestions).toHaveLength(1)
    expect(suggestions[0].kind).toBe('credit_card_payment')
  })

  it('surfaces a tag-conflicting pair as a suggestion, never an auto-apply', () => {
    // The outflow is tagged TRANSFER_OUT_ACCOUNT_TRANSFER but the only same-amount inflow
    // lands on the visa. Plaid outflow tags are noisy and an exact-amount credit inflow is
    // a strong structural hint the tag is wrong — so the exact driver refuses (kind
    // mismatch), and the credit inflow's own weak driver asks the user instead.
    const cardIn = item({ id: 'card-in', amount: -1000, date: '2026-08-02', accountId: 'visa' })
    const { autoApply, suggestions } = detect([transferOut, cardIn])
    expect(autoApply).toEqual([])
    expect(suggestions).toHaveLength(1)
    expect(suggestions[0]).toMatchObject({ kind: 'credit_card_payment', expense: { id: 'xfer-out' }, income: { id: 'card-in' } })
  })
})

describe('detectTransfers: gates', () => {
  it('requires the exact amount to the cent', () => {
    const offByOne = item({ ...paymentIn, id: 'in', amount: -500.01 })
    const { autoApply, suggestions } = detect([paymentOut, offByOne])
    expect(autoApply).toEqual([])
    expect(suggestions).toEqual([])
  })

  it('matches at the window boundary and refuses past it', () => {
    const day7 = item({ ...paymentIn, id: 'in-7', date: '2026-08-08' })
    expect(detect([paymentOut, day7]).autoApply).toHaveLength(1)

    const day8 = item({ ...paymentIn, id: 'in-8', date: '2026-08-09' })
    expect(detect([paymentOut, day8]).autoApply).toEqual([])
    expect(detect([paymentOut, day8]).suggestions).toEqual([])
  })

  it('never pairs two legs on the same account', () => {
    const sameAccountIn = item({ ...paymentIn, id: 'in', accountId: 'checking' })
    const result = detect([paymentOut, sameAccountIn])
    expect(result.autoApply).toEqual([])
    expect(result.suggestions).toEqual([])
  })

  it('skips pending legs entirely: their ids are replaced when they post', () => {
    const pendingIn = item({ ...paymentIn, id: 'in', pending: true })
    expect(detect([paymentOut, pendingIn]).autoApply).toEqual([])

    const pendingOut = item({ ...paymentOut, id: 'out', pending: true })
    expect(detect([pendingOut, paymentIn]).autoApply).toEqual([])
  })

  it('skips legs already in a transfer', () => {
    const alreadyLinked = item({ ...paymentIn, id: 'in', transferId: 't1', transferKind: 'credit_card_payment', transferRole: 'income' })
    expect(detect([paymentOut, alreadyLinked]).autoApply).toEqual([])
  })

  it('skips reimbursement-linked legs', () => {
    const reimbursed = item({ ...paymentOut, id: 'out', reimbursedAmount: 100, netAmount: 400 })
    expect(detect([reimbursed, paymentIn]).autoApply).toEqual([])
  })

  it('never re-creates a dismissed pair, from either side', () => {
    expect(detect([paymentOut, paymentIn], { dismissedIds: new Set(['pay-out']) }).autoApply).toEqual([])
    // Even when the income leg drives (delta), the dismissed expense is not a candidate.
    const taggedIn = item({ ...paymentIn, pfcDetailed: 'LOAN_PAYMENTS_CREDIT_CARD_PAYMENT' })
    const driven = detect([paymentOut, taggedIn], { deltaIds: new Set(['pay-in']), dismissedIds: new Set(['pay-out']) })
    expect(driven.autoApply).toEqual([])
    expect(driven.suggestions).toEqual([])
  })

  it('ignores manual transactions on both sides', () => {
    const manualOut = item({ ...paymentOut, id: 'm-out', source: 'manual', accountId: null })
    expect(detect([manualOut, paymentIn]).autoApply).toEqual([])
  })

  it('ignores items with unknown accounts', () => {
    const unknownIn = item({ ...paymentIn, id: 'in', accountId: 'not-linked' })
    expect(detect([paymentOut, unknownIn]).autoApply).toEqual([])
  })

  it('drives nothing when the delta contains only unrelated items', () => {
    const unrelated = item({ id: 'lunch', amount: 12, date: '2026-08-01' })
    const result = detect([paymentOut, paymentIn, unrelated], { deltaIds: new Set(['lunch']) })
    expect(result.autoApply).toEqual([])
    expect(result.suggestions).toEqual([])
  })

  it('a full scan (no delta) drives everything eligible', () => {
    const result = detect([paymentOut, paymentIn], { deltaIds: null })
    expect(result.autoApply).toHaveLength(1)
  })
})

describe('brokerage contributions', () => {
  const accounts = [
    { account_id: 'acc-checking', type: 'depository', subtype: 'checking' },
    { account_id: 'acc-ira', type: 'investment', subtype: 'ira' },
    { account_id: 'acc-savings', type: 'depository', subtype: 'savings' },
  ] as unknown as Account[]

  const checkingOutflow = (over = {}) =>
    item({
      id: 'txn-out',
      source: 'plaid',
      accountId: 'acc-checking',
      amount: 1000,
      date: '2026-02-03',
      pfcDetailed: 'TRANSFER_OUT_INVESTMENT_AND_RETIREMENT_FUNDS',
      ...over,
    })

  const investmentInflow = (over = {}) =>
    item({
      id: 'itx-in',
      source: 'investment',
      accountId: 'acc-ira',
      amount: -1000,
      date: '2026-02-03',
      pfcDetailed: null,
      isBrokerageCashAccount: true,
      ...over,
    })

  it('auto-applies a contribution against its checking outflow', () => {
    const result = detectTransfers({ feed: [checkingOutflow(), investmentInflow()], accounts })

    expect(result.autoApply).toHaveLength(1)
    expect(result.autoApply[0]).toMatchObject({
      kind: 'account_transfer',
      amount: 1000,
    })
    expect(result.autoApply[0].expense.id).toBe('txn-out')
    expect(result.autoApply[0].income.id).toBe('itx-in')
    expect(result.suggestions).toEqual([])
  })

  it('pairs across the 7-day window', () => {
    const result = detectTransfers({
      feed: [checkingOutflow(), investmentInflow({ date: '2026-02-08' })],
      accounts,
    })
    expect(result.autoApply).toHaveLength(1)
  })

  it('does not pair beyond the window', () => {
    const result = detectTransfers({
      feed: [checkingOutflow(), investmentInflow({ date: '2026-02-20' })],
      accounts,
    })
    expect(result.autoApply).toEqual([])
    expect(result.suggestions).toEqual([])
  })

  it('does NOT auto-apply when the only counterpart is a savings account', () => {
    // The INVESTMENT_AND_RETIREMENT code only earns 'exact' when the account type corroborates it.
    const savingsInflow = item({
      id: 'txn-savings',
      source: 'plaid',
      accountId: 'acc-savings',
      amount: -1000,
      date: '2026-02-03',
      pfcDetailed: null,
    })
    const result = detectTransfers({ feed: [checkingOutflow(), savingsInflow], accounts })

    expect(result.autoApply).toEqual([])
    expect(result.suggestions).toHaveLength(1)
  })

  // Two equal outflows leaving the same brokerage cash account for two different banks on the
  // same day. Both drivers rank the same inflow first, and the second one used to be dropped
  // entirely rather than falling through to the counterpart still available — so one of the two
  // transfers was simply never offered.
  it('offers a second suggestion from the candidates the first one left', () => {
    const multiAccounts = [
      { account_id: 'acc-cma', type: 'depository', subtype: 'cash management' },
      { account_id: 'acc-bank', type: 'depository', subtype: 'checking' },
      { account_id: 'acc-bank2', type: 'depository', subtype: 'checking' },
    ] as unknown as Account[]
    const outflow = (id: string) =>
      item({
        id, accountId: 'acc-cma', amount: 5000, date: '2026-05-04',
        pfcDetailed: 'TRANSFER_OUT_ACCOUNT_TRANSFER', isBrokerageCashAccount: true,
      })
    const feed = [
      outflow('cma-out-1'),
      outflow('cma-out-2'),
      item({ id: 'bank-in', accountId: 'acc-bank', amount: -5000, date: '2026-05-04', pfcDetailed: 'INCOME_CONTRACTOR' }),
      item({ id: 'bank2-in', accountId: 'acc-bank2', amount: -5000, date: '2026-05-04', pfcDetailed: 'INCOME_CONTRACTOR' }),
    ]

    const result = detectTransfers({ feed, accounts: multiAccounts })

    expect(result.autoApply).toEqual([])
    expect(result.suggestions).toHaveLength(2)
    expect(result.suggestions.map((d) => d.expense.id).sort()).toEqual(['cma-out-1', 'cma-out-2'])
    expect(result.suggestions.map((d) => d.income.id).sort()).toEqual(['bank-in', 'bank2-in'])
  })

  // A redemption out of the core money-market fund, tagged TRANSFER_IN_INVESTMENT_AND_RETIREMENT_
  // FUNDS on the cash management account, is the fund paying cash into the account to cover an
  // outgoing transfer. Its counterpart is the fund, not another account — and because it is sized
  // to that transfer, it collides on amount with the very movement it funds. Left pairable, it
  // drives first and steals the bank leg from the real inbound transfer.
  it('does not let a PFC-internal brokerage row compete for another account\'s transfer', () => {
    const cmaAccounts = [
      { account_id: 'acc-cma', type: 'depository', subtype: 'cash management' },
      { account_id: 'acc-bank', type: 'depository', subtype: 'checking' },
    ] as unknown as Account[]
    const bankOutflow = item({
      id: 'bank-out', accountId: 'acc-bank', amount: 5000, date: '2026-05-04',
      pfcDetailed: 'TRANSFER_OUT_INVESTMENT_AND_RETIREMENT_FUNDS',
    })
    const realInbound = item({
      id: 'cma-in', accountId: 'acc-cma', amount: -5000, date: '2026-05-04',
      pfcDetailed: 'TRANSFER_IN_OTHER_TRANSFER_IN', isBrokerageCashAccount: true,
    })
    const redemption = item({
      id: 'cma-redemption', accountId: 'acc-cma', amount: -5000, date: '2026-05-04',
      pfcDetailed: 'TRANSFER_IN_INVESTMENT_AND_RETIREMENT_FUNDS', isBrokerageCashAccount: true,
    })

    const result = detectTransfers({ feed: [bankOutflow, realInbound, redemption], accounts: cmaAccounts })

    // The redemption is out of the running, which leaves exactly one candidate — so the real pair
    // is unambiguous and auto-applies.
    expect(result.autoApply).toHaveLength(1)
    expect(result.autoApply[0].expense.id).toBe('bank-out')
    expect(result.autoApply[0].income.id).toBe('cma-in')
    expect(result.suggestions).toEqual([])
  })

  // The same redemption, tagged with the generic account-transfer code instead. The institution
  // uses both for the identical event, so the guard above has to recognise both or it only holds
  // on the days the brokerage happened to be specific. Untreated, the redemption pairs with
  // whatever unrelated outflow shares its amount — which is exactly how a $4 core-fund redemption
  // ended up linked to a $4 payment on a different account.
  it('does not let a generically-tagged brokerage redemption compete either', () => {
    const cmaAccounts = [
      { account_id: 'acc-cma', type: 'depository', subtype: 'cash management' },
      { account_id: 'acc-bank', type: 'depository', subtype: 'checking' },
    ] as unknown as Account[]
    const unrelatedOutflow = item({
      id: 'bank-out', accountId: 'acc-bank', amount: 4, date: '2026-05-04',
      pfcDetailed: 'TRANSFER_OUT_ACCOUNT_TRANSFER',
    })
    const redemption = item({
      id: 'cma-redemption', accountId: 'acc-cma', amount: -4, date: '2026-05-04',
      pfcDetailed: 'TRANSFER_IN_ACCOUNT_TRANSFER', isBrokerageCashAccount: true,
    })

    const result = detectTransfers({ feed: [unrelatedOutflow, redemption], accounts: cmaAccounts })

    expect(result.autoApply).toEqual([])
    expect(result.suggestions).toEqual([])
  })

  // Money sent out of a brokerage cash account arrives at the receiving bank tagged INCOME_*: from
  // that bank's side an inbound ACH from a brokerage looks like being paid. isEligible drops
  // income-tagged inflows from the index, so such an outflow has no candidates at all — not an
  // ambiguous match, not a suggestion, nothing. It just counts as spending forever.
  it('lets a brokerage-cash outflow reach an income-tagged inflow, as a suggestion only', () => {
    const cmaAccounts = [
      { account_id: 'acc-cma', type: 'depository', subtype: 'cash management' },
      { account_id: 'acc-bank', type: 'depository', subtype: 'checking' },
    ] as unknown as Account[]
    const cmaOutflow = item({
      id: 'cma-out',
      accountId: 'acc-cma',
      amount: 5000,
      date: '2026-05-04',
      pfcDetailed: 'TRANSFER_OUT_ACCOUNT_TRANSFER',
      isBrokerageCashAccount: true,
    })
    const bankInflow = item({
      id: 'bank-in',
      accountId: 'acc-bank',
      amount: -5000,
      date: '2026-05-04',
      pfcDetailed: 'INCOME_CONTRACTOR',
    })

    const result = detectTransfers({ feed: [cmaOutflow, bankInflow], accounts: cmaAccounts })

    // Never auto-applied: an INCOME_ tag might be telling the truth, and silently hiding a real
    // paycheck is the one failure this detector must not have.
    expect(result.autoApply).toEqual([])
    expect(result.suggestions).toHaveLength(1)
    expect(result.suggestions[0].expense.id).toBe('cma-out')
    expect(result.suggestions[0].income.id).toBe('bank-in')
  })

  // An ordinary checking outflow gets no such licence: without a brokerage on either side, an
  // equal INCOME_ inflow is a paycheck that happens to match, and pairing it would erase income.
  it('does not let an ordinary checking outflow reach an income-tagged inflow', () => {
    const plainAccounts = [
      { account_id: 'acc-checking', type: 'depository', subtype: 'checking' },
      { account_id: 'acc-bank', type: 'depository', subtype: 'checking' },
    ] as unknown as Account[]
    const outflow = item({
      id: 'rent',
      accountId: 'acc-checking',
      amount: 5000,
      date: '2026-05-04',
      pfcDetailed: 'TRANSFER_OUT_ACCOUNT_TRANSFER',
    })
    const paycheck = item({
      id: 'paycheck',
      accountId: 'acc-bank',
      amount: -5000,
      date: '2026-05-04',
      pfcDetailed: 'INCOME_WAGES',
    })

    const result = detectTransfers({ feed: [outflow, paycheck], accounts: plainAccounts })

    expect(result.autoApply).toEqual([])
    expect(result.suggestions).toEqual([])
  })

  // A bank stamps its outgoing wire to a brokerage TRANSFER_OUT_INVESTMENT_AND_RETIREMENT_FUNDS,
  // and it lands in a cash management account — which Plaid types `depository` / `cash management`,
  // so isInvestmentAccount rejects it and the code's corroboration can never be met. A cash
  // management account is the single most likely destination for this code; it has to count.
  it('auto-applies against a cash management counterpart, not just an investment account', () => {
    const cmaAccounts = [
      { account_id: 'acc-cma', type: 'depository', subtype: 'cash management' },
      { account_id: 'acc-bank', type: 'depository', subtype: 'checking' },
    ] as unknown as Account[]
    const bankOutflow = item({
      id: 'bank-out',
      accountId: 'acc-bank',
      amount: 5000,
      date: '2026-05-04',
      pfcDetailed: 'TRANSFER_OUT_INVESTMENT_AND_RETIREMENT_FUNDS',
    })
    const cmaInflow = item({
      id: 'cma-in',
      accountId: 'acc-cma',
      amount: -5000,
      date: '2026-05-04',
      pfcDetailed: 'TRANSFER_IN_OTHER_TRANSFER_IN',
      isBrokerageCashAccount: true,
    })

    const result = detectTransfers({ feed: [bankOutflow, cmaInflow], accounts: cmaAccounts })

    expect(result.autoApply).toHaveLength(1)
    expect(result.autoApply[0].expense.id).toBe('bank-out')
    expect(result.autoApply[0].income.id).toBe('cma-in')
  })

  // No brokerage-side driving test for the *_INVESTMENT_AND_RETIREMENT_FUNDS codes: on a brokerage
  // cash account those codes ARE the internal-movement marker, so isEligible rules the row out of
  // pairing entirely (see the redemption case above). Only the bank side drives them.
  it('suggests rather than auto-applies when two contributions compete for one outflow', () => {
    // Mutual uniqueness: silently picking one would depend on iteration order.
    const result = detectTransfers({
      feed: [
        checkingOutflow(),
        investmentInflow({ id: 'itx-a' }),
        investmentInflow({ id: 'itx-b', date: '2026-02-04' }),
      ],
      accounts,
    })

    expect(result.autoApply).toEqual([])
    expect(result.suggestions).toHaveLength(1)
  })

  it('never drives from the investment side — only the debit side has a PFC to trust', () => {
    const result = detectTransfers({ feed: [investmentInflow()], accounts })
    expect(result.autoApply).toEqual([])
    expect(result.suggestions).toEqual([])
  })

  it('still refuses manual entries as candidates', () => {
    const manual = item({ id: 'man-1', source: 'manual', accountId: null, amount: -1000, date: '2026-02-03' })
    const result = detectTransfers({ feed: [checkingOutflow(), manual], accounts })
    expect(result.autoApply).toEqual([])
  })

  it('skips a dismissed outflow', () => {
    const result = detectTransfers({
      feed: [checkingOutflow(), investmentInflow()],
      accounts,
      dismissedIds: new Set(['txn-out']),
    })
    expect(result.autoApply).toEqual([])
  })


  it('regression guard: a genuine contribution with the same shape still auto-applies', () => {
    // Pins that the isInvestmentIncome fix is not over-broad: it must reject only income
    // subtypes, not every investment inflow that happens to arrive within the window.
    const result = detectTransfers({
      feed: [checkingOutflow(), investmentInflow({ id: 'itx-contrib', date: '2026-02-05' })],
      accounts,
    })

    expect(result.autoApply).toHaveLength(1)
    expect(result.autoApply[0].income.id).toBe('itx-contrib')
  })
})

describe('brokerage contributions: fallback restrict scope', () => {
  const accounts = [
    { account_id: 'acc-checking', type: 'depository', subtype: 'checking' },
    { account_id: 'acc-ira', type: 'investment', subtype: 'ira' },
    { account_id: 'visa', type: 'credit' },
  ] as unknown as Account[]

  it('still surfaces a mistagged credit-card counterpart as a suggestion, never auto-applied', () => {
    // Before the fix, the Pass-1 fallback passed driver.restrict ('account_transfer') instead of
    // null, so a credit-card counterpart (kind 'credit_card_payment') was rejected by both the
    // forward call (not an investment account) and the fallback (wrong kind) — a suggestion the
    // pre-fallback code used to surface silently disappeared. restrict: null restores it.
    //
    // deltaIds restricts driving to the outflow alone: the card inflow is old and already in the
    // cache, so it never becomes its own Pass-2 weak driver — the ONLY path to a suggestion here
    // is the Pass-1 fallback. (Without this restriction, the card inflow would independently
    // drive in Pass 2 and mask the bug this test exists to pin.)
    const outflow = item({
      id: 'txn-out',
      source: 'plaid',
      accountId: 'acc-checking',
      amount: 1000,
      date: '2026-02-03',
      pfcDetailed: 'TRANSFER_OUT_INVESTMENT_AND_RETIREMENT_FUNDS',
    })
    const cardInflow = item({
      id: 'card-in',
      source: 'plaid',
      accountId: 'visa',
      amount: -1000,
      date: '2026-02-04',
      pfcDetailed: null,
    })

    const result = detectTransfers({
      feed: [outflow, cardInflow],
      accounts,
      deltaIds: new Set(['txn-out']),
    })

    expect(result.autoApply).toEqual([])
    expect(result.suggestions).toHaveLength(1)
    expect(result.suggestions[0].income.id).toBe('card-in')
  })
})

describe('investment rows as transfer legs', () => {
  // Only cash crossing the account boundary is ingested — trades, fees and dividends are filtered
  // out in the backend repository — so every investment row reaching the matcher is a legitimate
  // counterpart for a checking-side transfer.
  const accounts = [
    { account_id: 'acc-checking', type: 'depository', subtype: 'checking' },
    { account_id: 'acc-ira', type: 'investment', subtype: 'ira' },
  ] as unknown as Account[]

  const investmentRow = (over: Partial<FeedItem> & Pick<FeedItem, 'id' | 'amount' | 'date'>) =>
    item({
      source: 'investment',
      accountId: 'acc-ira',
      pfcDetailed: null,
      isBrokerageCashAccount: true,
      ...over,
    })


  it('auto-applies a withdrawal: brokerage -> checking, driven from the checking inflow', () => {
    // The mirror of the contribution case. The brokerage side carries no PFC code and so can
    // never drive, which means the checking INFLOW has to — and until TRANSFER_IN_INVESTMENT was
    // promoted alongside its OUT twin, that inflow was only ever a weak driver. Withdrawals sat
    // unmatched in the feed while contributions auto-applied, for no reason a user could see.
    const withdrawal = investmentRow({ id: 'itx-wd', amount: 2000, date: '2026-05-18' })
    const checkingIn = item({
      id: 'txn-in',
      accountId: 'acc-checking',
      amount: -2000,
      date: '2026-05-18',
      pfcDetailed: 'TRANSFER_IN_INVESTMENT_AND_RETIREMENT_FUNDS',
    })
    const result = detectTransfers({ feed: [withdrawal, checkingIn], accounts })

    expect(result.autoApply).toHaveLength(1)
    expect(result.autoApply[0].expense.id).toBe('itx-wd')
    expect(result.autoApply[0].income.id).toBe('txn-in')
  })

  it('does NOT auto-apply a TRANSFER_IN_INVESTMENT whose counterpart is an ordinary account', () => {
    // Same corroboration rule as the OUT direction: the code alone is not enough, the counterpart
    // account type has to agree. A mistagged savings->checking move surfaces, never auto-applies.
    const savingsOut = item({ id: 'txn-savings', accountId: 'acc-savings', amount: 2000, date: '2026-05-18' })
    const checkingIn = item({
      id: 'txn-in',
      accountId: 'acc-checking',
      amount: -2000,
      date: '2026-05-18',
      pfcDetailed: 'TRANSFER_IN_INVESTMENT_AND_RETIREMENT_FUNDS',
    })
    const result = detectTransfers({
      feed: [savingsOut, checkingIn],
      accounts: [...accounts, { account_id: 'acc-savings', type: 'depository', subtype: 'savings' }] as never,
    })

    expect(result.autoApply).toEqual([])
    expect(result.suggestions).toHaveLength(1)
  })

  it('surfaces a withdrawal whose bank leg Plaid mis-tagged as an ordinary expense', () => {
    // Reported from real data: a $1,001.22 brokerage withdrawal landed in checking tagged
    // GENERAL_SERVICES_* ("service"), not TRANSFER_IN_*. Neither side could drive — the bank leg
    // has no transfer code, and investment rows have no PFC at all — so the pair was never even
    // considered. Nothing appeared: no auto-match AND no suggestion.
    const withdrawal = investmentRow({ id: 'itx-wd', amount: 1001.22, date: '2026-05-06' })
    const bankIn = item({
      id: 'txn-in',
      accountId: 'acc-checking',
      amount: -1001.22,
      date: '2026-05-07',
      pfcDetailed: 'GENERAL_SERVICES_OTHER_GENERAL_SERVICES',
    })
    const result = detectTransfers({ feed: [withdrawal, bankIn], accounts })

    // Suggestion, not auto-apply: "this row touched a brokerage" is a strong structural signal
    // but not proof, so it costs one tap rather than silently hiding money.
    expect(result.autoApply).toEqual([])
    expect(result.suggestions).toHaveLength(1)
    expect(result.suggestions[0].expense.id).toBe('itx-wd')
    expect(result.suggestions[0].income.id).toBe('txn-in')
  })

  it('surfaces an untagged contribution from the brokerage side too', () => {
    // The same gap in the other direction: money arriving in the brokerage with the bank leg
    // untagged. Symmetric, because the driver is the investment row either way.
    const contribution = investmentRow({ id: 'itx-contrib', amount: -750, date: '2026-05-06' })
    const bankOut = item({
      id: 'txn-out',
      accountId: 'acc-checking',
      amount: 750,
      date: '2026-05-06',
      pfcDetailed: 'GENERAL_SERVICES_OTHER_GENERAL_SERVICES',
    })
    const result = detectTransfers({ feed: [contribution, bankOut], accounts })

    expect(result.autoApply).toEqual([])
    expect(result.suggestions).toHaveLength(1)
    expect(result.suggestions[0].expense.id).toBe('txn-out')
  })


  it('surfaces a withdrawal whose bank leg Plaid tagged as INCOME_', () => {
    // The reported case, from real data. An outbound ACH from Fidelity lands in checking and
    // Plaid tags it INCOME_* — from the bank's side that is what it resembles. isEligible dropped
    // income-tagged inflows from the index entirely, so the counterpart was not rejected during
    // pairing, it was absent: nothing was ever considered, and no suggestion appeared.
    const withdrawal = investmentRow({ id: 'itx-wd', amount: 1001.22, date: '2026-05-06' })
    const bankIn = item({
      id: 'txn-in',
      accountId: 'acc-checking',
      amount: -1001.22,
      date: '2026-05-06',
      pfcDetailed: 'INCOME_OTHER_INCOME',
    })
    const result = detectTransfers({ feed: [withdrawal, bankIn], accounts })

    // Suggestion only. An investment row of the same amount on the same day is strong evidence
    // against the INCOME_ tag, but not proof — auto-applying would erase real income when wrong.
    expect(result.autoApply).toEqual([])
    expect(result.suggestions).toHaveLength(1)
    expect(result.suggestions[0].expense.id).toBe('itx-wd')
    expect(result.suggestions[0].income.id).toBe('txn-in')
  })

  it('SAFETY: a wage is still never paired away by an ordinary outflow', () => {
    // The guard this relaxes exists so real income cannot be silently reclassified as a transfer.
    // Only an investment driver may overrule the tag; an equal checking outflow may not, however
    // close in date. Break this and a paycheck disappears from income totals.
    const rent = item({ id: 'txn-rent', accountId: 'acc-checking', amount: 3000, date: '2026-05-06' })
    const wages = item({
      id: 'txn-wages',
      accountId: 'acc-savings',
      amount: -3000,
      date: '2026-05-06',
      pfcDetailed: 'INCOME_WAGES',
    })
    const result = detectTransfers({
      feed: [rent, wages],
      accounts: [...accounts, { account_id: 'acc-savings', type: 'depository', subtype: 'savings' }] as never,
    })

    expect(result.autoApply).toEqual([])
    expect(result.suggestions).toEqual([])
  })

  it('SAFETY: an income-tagged leg is never auto-applied, even when uniquely matched', () => {
    // Exact driver on the bank side, one candidate each way — the shape that normally auto-applies.
    // The income tag must still hold it at a suggestion.
    const withdrawal = investmentRow({ id: 'itx-wd', amount: 500, date: '2026-05-06' })
    const bankIn = item({
      id: 'txn-in',
      accountId: 'acc-checking',
      amount: -500,
      date: '2026-05-06',
      pfcDetailed: 'INCOME_OTHER_INCOME',
    })
    const result = detectTransfers({ feed: [withdrawal, bankIn], accounts })

    expect(result.autoApply).toEqual([])
  })

  it('regression guard: household money on the same account still pairs', () => {
    // Investment rows are eligible candidates: every one ingested is cash crossing the account
    // boundary, which is exactly what a checking-side transfer pairs against.
    const contribution = investmentRow({
      id: 'itx-contrib',
      amount: -1000,
      date: '2026-02-03',
    })
    const outflow = item({
      id: 'txn-out',
      accountId: 'acc-checking',
      amount: 1000,
      date: '2026-02-03',
      pfcDetailed: 'TRANSFER_OUT_INVESTMENT_AND_RETIREMENT_FUNDS',
    })
    const result = detectTransfers({ feed: [outflow, contribution], accounts })

    expect(result.autoApply).toHaveLength(1)
    expect(result.autoApply[0].income.id).toBe('itx-contrib')
  })
})

// ---------------------------------------------------------------------------------------------

import { detectPendingPreviews } from './autoMatch'

describe('detectPendingPreviews', () => {
  const pendingOut = item({
    id: 'pend-out', amount: 600, date: '2026-08-11', accountId: 'checking',
    pending: true, pfcDetailed: 'TRANSFER_OUT_ACCOUNT_TRANSFER',
  })
  const postedIn = item({ id: 'posted-in', amount: -600, date: '2026-08-11', accountId: 'savings' })

  it('previews a pair when a leg is pending and a transfer signal exists', () => {
    const previews = detectPendingPreviews({ feed: [pendingOut, postedIn], accounts })
    expect(previews).toHaveLength(1)
    expect(previews[0].expense.id).toBe('pend-out')
    expect(previews[0].income.id).toBe('posted-in')
    expect(previews[0].kind).toBe('account_transfer')
  })

  it('ignores fully posted pairs — those belong to detectTransfers', () => {
    const out = { ...pendingOut, pending: false }
    expect(detectPendingPreviews({ feed: [out, postedIn], accounts })).toHaveLength(0)
  })

  it('requires a transfer-shaped signal so coincidental equal charges never preview', () => {
    const blandOut = item({ id: 'lunch-1', amount: 12, date: '2026-08-11', accountId: 'checking', pending: true })
    const blandIn = item({ id: 'lunch-2', amount: -12, date: '2026-08-11', accountId: 'savings' })
    expect(detectPendingPreviews({ feed: [blandOut, blandIn], accounts })).toHaveLength(0)
  })

  it('classifies a pending credit-account inflow as a credit card payment', () => {
    const cardIn = item({ id: 'card-in', amount: -600, date: '2026-08-10', accountId: 'visa', pending: true })
    const out = item({ id: 'chk-out', amount: 600, date: '2026-08-11', accountId: 'checking' })
    const previews = detectPendingPreviews({ feed: [out, cardIn], accounts })
    expect(previews).toHaveLength(1)
    expect(previews[0].kind).toBe('credit_card_payment')
  })

  it('respects dismissals and the date window', () => {
    expect(
      detectPendingPreviews({ feed: [pendingOut, postedIn], accounts, dismissedIds: new Set(['pend-out']) }),
    ).toHaveLength(0)
    const lateIn = { ...postedIn, date: '2026-08-25' }
    expect(detectPendingPreviews({ feed: [pendingOut, lateIn], accounts })).toHaveLength(0)
  })
})
