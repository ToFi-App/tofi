import { describe, expect, it } from 'vitest'
import { resolveCategory, mergeFeed, applyTransfers } from './resolveFeed'
import type { PlaidCategoryMapping, TransactionOverride, VendorMapping, ManualTransaction, PlaidTransaction, Transfer, InvestmentTransaction } from '@/types/domain'

const overrides: TransactionOverride[] = [
  { id: 'o1', plaidTransactionId: 'txn-override', categoryId: 'cat-override', subcategoryId: null, note: null },
]
const vendorMappings: VendorMapping[] = [
  { id: 'v1', vendorName: 'Panda Express', categoryId: 'cat-user', subcategoryId: 'sub-user', source: 'user_defined' },
  { id: 'v2', vendorName: 'Panda Express', categoryId: 'cat-auto', subcategoryId: null, source: 'plaid_auto' },
  { id: 'v3', vendorName: 'Only Auto Vendor', categoryId: 'cat-auto-only', subcategoryId: null, source: 'plaid_auto' },
]

describe('resolveCategory', () => {
  it('prefers a transaction_override over any vendor mapping', () => {
    const result = resolveCategory({ transactionId: 'txn-override', merchantName: 'Panda Express' }, overrides, vendorMappings)
    expect(result).toEqual({ categoryId: 'cat-override', subcategoryId: null, categorySource: 'override' })
  })

  it('prefers a user_defined vendor mapping over a plaid_auto one for the same merchant', () => {
    const result = resolveCategory({ transactionId: 'txn-other', merchantName: 'Panda Express' }, overrides, vendorMappings)
    expect(result).toEqual({ categoryId: 'cat-user', subcategoryId: 'sub-user', categorySource: 'user_defined' })
  })

  it('falls back to plaid_auto when no user_defined mapping exists for the merchant', () => {
    const result = resolveCategory({ transactionId: 'txn-other', merchantName: 'Only Auto Vendor' }, overrides, vendorMappings)
    expect(result).toEqual({ categoryId: 'cat-auto-only', subcategoryId: null, categorySource: 'plaid_auto' })
  })

  it('falls back to uncategorized when nothing matches', () => {
    const result = resolveCategory({ transactionId: 'txn-unknown', merchantName: 'Unknown Merchant' }, overrides, vendorMappings)
    expect(result).toEqual({ categoryId: null, subcategoryId: null, categorySource: 'uncategorized' })
  })

  it('falls back to uncategorized when merchantName is null', () => {
    const result = resolveCategory({ transactionId: 'txn-null-merchant', merchantName: null }, overrides, vendorMappings)
    expect(result).toEqual({ categoryId: null, subcategoryId: null, categorySource: 'uncategorized' })
  })
})

// A transaction's own personal_finance_category, resolved through plaid_category_mappings, is
// the step that keeps merchant_name-less transactions (ACH, checks, Zelle, direct deposits —
// Plaid leaves merchant_name null for anything it can't merchant-enrich) out of Uncategorized,
// and covers every merchant first seen after onboarding generated the vendor_mappings.
describe('resolveCategory PFC fallback', () => {
  const pfcMappings: PlaidCategoryMapping[] = [
    { id: 'pm1', plaidPfcPrimary: 'FOOD_AND_DRINK', plaidPfcDetailed: 'FOOD_AND_DRINK_GROCERIES', categoryId: 'cat-food' },
    { id: 'pm2', plaidPfcPrimary: 'TRANSFER_IN', plaidPfcDetailed: 'TRANSFER_IN_DEPOSIT', categoryId: 'cat-transfers-in' },
    { id: 'pm3', plaidPfcPrimary: 'MEDICAL', plaidPfcDetailed: null, categoryId: 'cat-health-primary-only' },
    { id: 'pm4', plaidPfcPrimary: 'MEDICAL', plaidPfcDetailed: 'MEDICAL_DENTAL', categoryId: 'cat-health-detailed' },
  ]

  it('categorizes a transaction with no merchant_name via its PFC detailed code', () => {
    const result = resolveCategory(
      { transactionId: 'txn-ach', merchantName: null, pfcPrimary: 'TRANSFER_IN', pfcDetailed: 'TRANSFER_IN_DEPOSIT' },
      overrides,
      vendorMappings,
      pfcMappings,
    )
    expect(result).toEqual({ categoryId: 'cat-transfers-in', subcategoryId: null, categorySource: 'plaid_pfc' })
  })

  it('labels a PFC that came from an MCC crosswalk as mcc_pfc, not plaid_pfc', () => {
    const result = resolveCategory(
      { transactionId: 'txn-apple-card', merchantName: 'Brand New Grocer', pfcPrimary: 'FOOD_AND_DRINK', pfcDetailed: 'FOOD_AND_DRINK_GROCERIES', pfcSource: 'mcc' },
      overrides,
      vendorMappings,
      pfcMappings,
    )
    expect(result).toEqual({ categoryId: 'cat-food', subcategoryId: null, categorySource: 'mcc_pfc' })
  })

  it('still prefers an override over an MCC-derived PFC', () => {
    const result = resolveCategory(
      { transactionId: 'txn-override', merchantName: null, pfcPrimary: 'FOOD_AND_DRINK', pfcDetailed: 'FOOD_AND_DRINK_GROCERIES', pfcSource: 'mcc' },
      overrides,
      vendorMappings,
      pfcMappings,
    )
    expect(result.categorySource).toBe('override')
  })

  it('categorizes a merchant that has no vendor mapping yet via its PFC detailed code', () => {
    const result = resolveCategory(
      { transactionId: 'txn-new', merchantName: 'Brand New Grocer', pfcPrimary: 'FOOD_AND_DRINK', pfcDetailed: 'FOOD_AND_DRINK_GROCERIES' },
      overrides,
      vendorMappings,
      pfcMappings,
    )
    expect(result).toEqual({ categoryId: 'cat-food', subcategoryId: null, categorySource: 'plaid_pfc' })
  })

  it('ranks vendor mappings above the PFC fallback, so user intent still wins', () => {
    const result = resolveCategory(
      { transactionId: 'txn-panda', merchantName: 'Panda Express', pfcPrimary: 'FOOD_AND_DRINK', pfcDetailed: 'FOOD_AND_DRINK_GROCERIES' },
      overrides,
      vendorMappings,
      pfcMappings,
    )
    expect(result).toEqual({ categoryId: 'cat-user', subcategoryId: 'sub-user', categorySource: 'user_defined' })
  })

  it('ranks an override above the PFC fallback', () => {
    const result = resolveCategory(
      { transactionId: 'txn-override', merchantName: null, pfcPrimary: 'FOOD_AND_DRINK', pfcDetailed: 'FOOD_AND_DRINK_GROCERIES' },
      overrides,
      vendorMappings,
      pfcMappings,
    )
    expect(result).toEqual({ categoryId: 'cat-override', subcategoryId: null, categorySource: 'override' })
  })

  // Guards against a Plaid taxonomy addition silently dumping a whole primary into Uncategorized.
  it('falls back to a primary-only mapping row when the detailed code is unrecognized', () => {
    const result = resolveCategory(
      { transactionId: 'txn-future', merchantName: null, pfcPrimary: 'MEDICAL', pfcDetailed: 'MEDICAL_SOME_NEW_PLAID_CODE' },
      overrides,
      vendorMappings,
      pfcMappings,
    )
    expect(result).toEqual({ categoryId: 'cat-health-primary-only', subcategoryId: null, categorySource: 'plaid_pfc' })
  })

  it('prefers the detailed match over the primary-only row for the same primary', () => {
    const result = resolveCategory(
      { transactionId: 'txn-dental', merchantName: null, pfcPrimary: 'MEDICAL', pfcDetailed: 'MEDICAL_DENTAL' },
      overrides,
      vendorMappings,
      pfcMappings,
    )
    expect(result.categoryId).toBe('cat-health-detailed')
  })

  // seedCategories only ever writes rows with a detailed code, so the primary fallback has to
  // work off those rows too rather than requiring a primary-only row that never exists.
  it('falls back to any row sharing the primary when no primary-only row exists', () => {
    const result = resolveCategory(
      { transactionId: 'txn-future-food', merchantName: null, pfcPrimary: 'FOOD_AND_DRINK', pfcDetailed: 'FOOD_AND_DRINK_SOME_NEW_CODE' },
      overrides,
      vendorMappings,
      pfcMappings,
    )
    expect(result).toEqual({ categoryId: 'cat-food', subcategoryId: null, categorySource: 'plaid_pfc' })
  })

  it('stays uncategorized when the PFC primary is mapped to nothing at all', () => {
    const result = resolveCategory(
      { transactionId: 'txn-unmapped', merchantName: null, pfcPrimary: 'BANK_FEES', pfcDetailed: 'BANK_FEES_ATM_FEES' },
      overrides,
      vendorMappings,
      pfcMappings,
    )
    expect(result).toEqual({ categoryId: null, subcategoryId: null, categorySource: 'uncategorized' })
  })

  it('stays uncategorized when the transaction carries no PFC at all', () => {
    const result = resolveCategory(
      { transactionId: 'txn-no-pfc', merchantName: null, pfcPrimary: null, pfcDetailed: null },
      overrides,
      vendorMappings,
      pfcMappings,
    )
    expect(result).toEqual({ categoryId: null, subcategoryId: null, categorySource: 'uncategorized' })
  })
})

describe('mergeFeed PFC fallback', () => {
  const pfcMappings: PlaidCategoryMapping[] = [
    { id: 'pm1', plaidPfcPrimary: 'TRANSFER_IN', plaidPfcDetailed: 'TRANSFER_IN_DEPOSIT', categoryId: 'cat-transfers-in' },
  ]

  const achTxn = [
    {
      transaction_id: 'ach-1',
      account_id: 'acc-1',
      amount: -2400,
      date: '2026-06-15',
      name: 'DIRECT DEP PAYROLL',
      merchant_name: null,
      pending: false,
      personal_finance_category: { primary: 'TRANSFER_IN', detailed: 'TRANSFER_IN_DEPOSIT', confidence_level: 'HIGH' },
    },
  ] as unknown as PlaidTransaction[]

  it('threads each transaction’s PFC into the resolution chain', () => {
    const feed = mergeFeed(achTxn, [], [], [], pfcMappings)
    expect(feed[0]).toMatchObject({ categoryId: 'cat-transfers-in', categorySource: 'plaid_pfc' })
  })

  it('leaves the item uncategorized when no PFC mappings are supplied', () => {
    const feed = mergeFeed(achTxn, [], [], [], [])
    expect(feed[0]).toMatchObject({ categoryId: null, categorySource: 'uncategorized' })
  })

  it('never applies the PFC fallback to manual transactions, which carry no PFC', () => {
    const manual = [
      { id: 'm1', amount: '5.00', type: 'expense', categoryId: null, subcategoryId: null, date: '2026-06-20', note: 'Cash' },
    ] as ManualTransaction[]
    const feed = mergeFeed([], manual, [], [], pfcMappings)
    expect(feed[0]).toMatchObject({ categoryId: null, categorySource: 'uncategorized' })
  })
})

describe('mergeFeed', () => {
  const plaidTxns = [
    {
      transaction_id: 'p1',
      account_id: 'acc-1',
      amount: 35.5,
      date: '2026-06-21',
      name: 'PANDA EXPRESS #123',
      merchant_name: 'Panda Express',
      pending: false,
      personal_finance_category: { primary: 'FOOD_AND_DRINK', detailed: 'FOOD_AND_DRINK_FAST_FOOD', confidence_level: 'HIGH' },
    },
  ] as unknown as PlaidTransaction[]

  const manualTxns = [
    { id: 'm1', amount: '5.00', type: 'expense', categoryId: 'cat-food', subcategoryId: null, date: '2026-06-20', note: 'Street food' },
    { id: 'm2', amount: '30.00', type: 'income', categoryId: null, subcategoryId: null, date: '2026-06-19', note: 'Zelle from Alice' },
  ] as ManualTransaction[]

  it('merges Plaid and manual transactions into one array, sorted by date descending', () => {
    const feed = mergeFeed(plaidTxns, manualTxns, [], [])
    expect(feed.map((item) => item.id)).toEqual(['p1', 'm1', 'm2'])
  })

  it('tags each item with its source and resolves Plaid category via resolveCategory', () => {
    const vendorMappings = [{ id: 'v1', vendorName: 'Panda Express', categoryId: 'cat-food', subcategoryId: null, source: 'plaid_auto' as const }]
    const feed = mergeFeed(plaidTxns, [], [], vendorMappings)
    expect(feed[0]).toMatchObject({ source: 'plaid', categoryId: 'cat-food', categorySource: 'plaid_auto', merchantName: 'Panda Express' })
  })

  it('gives manual expenses a positive amount and manual income a negative amount, matching Plaid convention', () => {
    const feed = mergeFeed([], manualTxns, [], [])
    const expense = feed.find((item) => item.id === 'm1')!
    const income = feed.find((item) => item.id === 'm2')!
    expect(expense.amount).toBe(5)
    expect(income.amount).toBe(-30)
  })

  it('uses the manual transaction note as its display merchant name', () => {
    const feed = mergeFeed([], manualTxns, [], [])
    expect(feed.find((item) => item.id === 'm1')!.merchantName).toBe('Street food')
  })

  it('carries the raw PFC detailed code on Plaid items and null on manual items', () => {
    const feed = mergeFeed(plaidTxns, manualTxns, [], [])
    expect(feed.find((item) => item.id === 'p1')!.pfcDetailed).toBe('FOOD_AND_DRINK_FAST_FOOD')
    expect(feed.find((item) => item.id === 'm1')!.pfcDetailed).toBeNull()
  })
})

// Shared by the reimbursement suite and the end-to-end pipeline suite below: the
// product.md $100 dinner split three ways, in raw Plaid shape rather than pre-built FeedItems.
const dinnerPlaidTxns = [
  {
    transaction_id: 'expense-1', account_id: 'acc-1', amount: 100, date: '2026-06-21', name: 'THE GOOD FORK',
    merchant_name: 'Dinner', pending: false,
    personal_finance_category: { primary: 'FOOD_AND_DRINK', detailed: 'FOOD_AND_DRINK_RESTAURANT', confidence_level: 'HIGH' },
  },
  {
    transaction_id: 'income-alice', account_id: 'acc-1', amount: -30, date: '2026-06-19', name: 'ZELLE FROM ALICE',
    merchant_name: 'Zelle from Alice', pending: false,
    personal_finance_category: { primary: 'TRANSFER_IN', detailed: 'TRANSFER_IN_ACCOUNT_TRANSFER', confidence_level: 'HIGH' },
  },
  {
    transaction_id: 'income-bob', account_id: 'acc-1', amount: -30, date: '2026-06-20', name: 'ZELLE FROM BOB',
    merchant_name: 'Zelle from Bob', pending: false,
    personal_finance_category: { primary: 'TRANSFER_IN', detailed: 'TRANSFER_IN_ACCOUNT_TRANSFER', confidence_level: 'HIGH' },
  },
] as unknown as PlaidTransaction[]

const dinnerVendorMappings: VendorMapping[] = [
  { id: 'vm-dinner', vendorName: 'Dinner', categoryId: 'cat-food', subcategoryId: null, source: 'plaid_auto' },
  { id: 'vm-alice', vendorName: 'Zelle from Alice', categoryId: 'cat-transfers-in', subcategoryId: null, source: 'plaid_auto' },
  { id: 'vm-bob', vendorName: 'Zelle from Bob', categoryId: 'cat-transfers-in', subcategoryId: null, source: 'plaid_auto' },
]

describe('applyTransfers — reimbursements', () => {
  // Built by actually running mergeFeed, so a FeedItem shape change breaks these tests
  // instead of silently passing behind a cast.
  const baseFeed = mergeFeed(dinnerPlaidTxns, [], [], dinnerVendorMappings)

  const reimbursements: Transfer[] = [
    { id: 'r1', kind: 'reimbursement', source: 'manual', expensePlaidTransactionId: 'expense-1', expenseManualTransactionId: null, incomePlaidTransactionId: 'income-alice', incomeManualTransactionId: null, amount: '30.00', note: null },
    { id: 'r2', kind: 'reimbursement', source: 'manual', expensePlaidTransactionId: 'expense-1', expenseManualTransactionId: null, incomePlaidTransactionId: 'income-bob', incomeManualTransactionId: null, amount: '30.00', note: null },
  ]

  it('computes net expense as original minus the sum of all linked reimbursements', () => {
    const result = applyTransfers(baseFeed, reimbursements)
    const expense = result.find((item) => item.id === 'expense-1')!
    expect(expense.reimbursedAmount).toBe(60)
    expect(expense.netAmount).toBe(40)
  })

  it('tags each linked income row as a reimbursement, carrying the expense category', () => {
    const result = applyTransfers(baseFeed, reimbursements)
    const alice = result.find((item) => item.id === 'income-alice')!
    expect(alice.isReimbursementIncome).toBe(true)
    expect(alice.reimbursementCategoryId).toBe('cat-food')
  })

  it('never lets net expense go negative when reimbursements exceed the original amount', () => {
    const overReimbursed: Transfer[] = [
      { id: 'r1', kind: 'reimbursement', source: 'manual', expensePlaidTransactionId: 'expense-1', expenseManualTransactionId: null, incomePlaidTransactionId: 'income-alice', incomeManualTransactionId: null, amount: '150.00', note: null },
    ]
    const result = applyTransfers(baseFeed, overReimbursed)
    expect(result.find((item) => item.id === 'expense-1')!.netAmount).toBe(0)
  })

  it('leaves unrelated feed items unchanged', () => {
    const result = applyTransfers(baseFeed, [])
    expect(result).toEqual(baseFeed)
  })
})

// End-to-end: resolveCategory -> mergeFeed -> applyTransfers chained on one realistic
// dataset, starting from raw Plaid/manual shapes rather than hand-built FeedItems. This is
// the product.md $100 dinner / $30 Alice / $30 Bob / $40 net scenario.
describe('resolveFeed pipeline', () => {
  const pipelineOverrides: TransactionOverride[] = [
    // User re-categorized the dinner away from its plaid_auto mapping.
    { id: 'o-dinner', plaidTransactionId: 'expense-1', categoryId: 'cat-dining-out', subcategoryId: 'sub-restaurants', note: null },
  ]

  const manualTxns = [
    { id: 'm-coffee', amount: '4.75', type: 'expense', categoryId: 'cat-food', subcategoryId: null, date: '2026-06-22', note: 'Coffee cart' },
  ] as ManualTransaction[]

  const pipelineReimbursements: Transfer[] = [
    { id: 'r1', kind: 'reimbursement', source: 'manual', expensePlaidTransactionId: 'expense-1', expenseManualTransactionId: null, incomePlaidTransactionId: 'income-alice', incomeManualTransactionId: null, amount: '30.00', note: null },
    { id: 'r2', kind: 'reimbursement', source: 'manual', expensePlaidTransactionId: 'expense-1', expenseManualTransactionId: null, incomePlaidTransactionId: 'income-bob', incomeManualTransactionId: null, amount: '30.00', note: null },
  ]

  function runPipeline() {
    const merged = mergeFeed(dinnerPlaidTxns, manualTxns, pipelineOverrides, dinnerVendorMappings)
    return applyTransfers(merged, pipelineReimbursements)
  }

  it('sorts the merged Plaid + manual feed by date descending', () => {
    expect(runPipeline().map((item) => item.id)).toEqual(['m-coffee', 'expense-1', 'income-bob', 'income-alice'])
  })

  it('resolves categories through the full precedence chain before reimbursements are applied', () => {
    const result = runPipeline()
    const dinner = result.find((item) => item.id === 'expense-1')!
    const alice = result.find((item) => item.id === 'income-alice')!
    const coffee = result.find((item) => item.id === 'm-coffee')!

    expect(dinner).toMatchObject({ categoryId: 'cat-dining-out', subcategoryId: 'sub-restaurants', categorySource: 'override' })
    expect(alice).toMatchObject({ categoryId: 'cat-transfers-in', categorySource: 'plaid_auto' })
    expect(coffee).toMatchObject({ source: 'manual', categoryId: 'cat-food', categorySource: 'user_defined', amount: 4.75 })
  })

  it('nets the $100 expense down to $40 after two $30 reimbursements', () => {
    const dinner = runPipeline().find((item) => item.id === 'expense-1')!
    expect(dinner.amount).toBe(100)
    expect(dinner.reimbursedAmount).toBe(60)
    expect(dinner.netAmount).toBe(40)
  })

  it('tags both income rows as reimbursements carrying the overridden expense category', () => {
    const result = runPipeline()
    for (const id of ['income-alice', 'income-bob']) {
      const income = result.find((item) => item.id === id)!
      expect(income.amount).toBe(-30)
      expect(income.isReimbursementIncome).toBe(true)
      // The override, not the vendor mapping, is what propagates to the income rows.
      expect(income.reimbursementCategoryId).toBe('cat-dining-out')
    }
  })

  it('leaves the unrelated manual expense untouched by reimbursement math', () => {
    const coffee = runPipeline().find((item) => item.id === 'm-coffee')!
    expect(coffee.reimbursedAmount).toBeNull()
    expect(coffee.netAmount).toBeNull()
    expect(coffee.isReimbursementIncome).toBe(false)
  })
})

describe('applyTransfers', () => {
  const plaidTxns = [
    { transaction_id: 'out', account_id: 'checking', amount: 500, date: '2026-08-10', name: 'TRANSFER TO SAVINGS', merchant_name: null, pending: false },
    { transaction_id: 'in', account_id: 'savings', amount: -500, date: '2026-08-11', name: 'TRANSFER FROM CHECKING', merchant_name: null, pending: false },
    { transaction_id: 'lunch', account_id: 'checking', amount: 12, date: '2026-08-10', name: 'DELI', merchant_name: 'Deli', pending: false },
  ] as unknown as PlaidTransaction[]

  const feed = mergeFeed(plaidTxns, [], [], [])

  function find(items: ReturnType<typeof mergeFeed>, id: string) {
    return items.find((item) => item.id === id)!
  }

  it('stamps both legs of a paired transfer with the same id and kind', () => {
    const transfers: Transfer[] = [
      { id: 't1', kind: 'account_transfer', source: 'manual', expensePlaidTransactionId: 'out', expenseManualTransactionId: null, incomePlaidTransactionId: 'in', incomeManualTransactionId: null, amount: '500.00', note: null },
    ]
    const result = applyTransfers(feed, transfers)

    expect(find(result, 'out')).toMatchObject({ transferId: 't1', transferKind: 'account_transfer', transferRole: 'expense' })
    expect(find(result, 'in')).toMatchObject({ transferId: 't1', transferKind: 'account_transfer', transferRole: 'income' })
  })

  it('carries the transfer source onto both legs so the UI can badge auto-detected links', () => {
    const transfers: Transfer[] = [
      { id: 't1', kind: 'credit_card_payment', source: 'auto', expensePlaidTransactionId: 'out', expenseManualTransactionId: null, incomePlaidTransactionId: 'in', incomeManualTransactionId: null, amount: '500.00', note: null },
    ]
    const result = applyTransfers(feed, transfers)

    expect(find(result, 'out').transferSource).toBe('auto')
    expect(find(result, 'in').transferSource).toBe('auto')
    expect(find(result, 'lunch').transferSource).toBeNull()
  })

  it('stamps only the expense when the transfer is unpaired', () => {
    const transfers: Transfer[] = [
      { id: 't1', kind: 'account_transfer', source: 'manual', expensePlaidTransactionId: 'out', expenseManualTransactionId: null, incomePlaidTransactionId: null, incomeManualTransactionId: null, amount: '500.00', note: null },
    ]
    const result = applyTransfers(feed, transfers)

    expect(find(result, 'out').transferRole).toBe('expense')
    expect(find(result, 'in').transferKind).toBeNull()
  })

  it('still stamps the expense when the income leg falls outside the loaded window', () => {
    const transfers: Transfer[] = [
      { id: 't1', kind: 'account_transfer', source: 'manual', expensePlaidTransactionId: 'out', expenseManualTransactionId: null, incomePlaidTransactionId: 'not-loaded', incomeManualTransactionId: null, amount: '500.00', note: null },
    ]
    const result = applyTransfers(feed, transfers)

    expect(find(result, 'out')).toMatchObject({ transferId: 't1', transferRole: 'expense' })
  })

  it('resolves manual-transaction legs by their uuid', () => {
    const manualTxns = [
      { id: 'm-out', amount: '200.00', type: 'expense', categoryId: null, subcategoryId: null, date: '2026-08-10', note: 'Cash to savings' },
    ] as ManualTransaction[]
    const withManual = mergeFeed(plaidTxns, manualTxns, [], [])
    const transfers: Transfer[] = [
      { id: 't2', kind: 'credit_card_payment', source: 'manual', expensePlaidTransactionId: null, expenseManualTransactionId: 'm-out', incomePlaidTransactionId: null, incomeManualTransactionId: null, amount: '200.00', note: null },
    ]
    const result = applyTransfers(withManual, transfers)

    expect(find(result, 'm-out')).toMatchObject({ transferId: 't2', transferKind: 'credit_card_payment', transferRole: 'expense' })
  })

  it('leaves unrelated transactions untouched', () => {
    const transfers: Transfer[] = [
      { id: 't1', kind: 'account_transfer', source: 'manual', expensePlaidTransactionId: 'out', expenseManualTransactionId: null, incomePlaidTransactionId: 'in', incomeManualTransactionId: null, amount: '500.00', note: null },
    ]
    const result = applyTransfers(feed, transfers)

    expect(find(result, 'lunch')).toMatchObject({ transferId: null, transferKind: null, transferRole: null })
  })

  it('returns the feed unchanged when there are no transfers', () => {
    expect(applyTransfers(feed, [])).toEqual(feed)
  })

  it('sets reimbursedAmount and netAmount for reimbursement-kind transfers', () => {
    const transfers: Transfer[] = [
      { id: 'r1', kind: 'reimbursement', source: 'manual', expensePlaidTransactionId: 'out', expenseManualTransactionId: null, incomePlaidTransactionId: 'in', incomeManualTransactionId: null, amount: '200.00', note: null },
    ]
    const result = applyTransfers(feed, transfers)

    expect(find(result, 'out')).toMatchObject({ reimbursedAmount: 200, netAmount: 300 })
    expect(find(result, 'in')).toMatchObject({ isReimbursementIncome: true })
  })

  it('accumulates multiple reimbursement transfers on the same expense', () => {
    const transfers: Transfer[] = [
      { id: 'r1', kind: 'reimbursement', source: 'manual', expensePlaidTransactionId: 'out', expenseManualTransactionId: null, incomePlaidTransactionId: 'in', incomeManualTransactionId: null, amount: '200.00', note: null },
      { id: 'r2', kind: 'reimbursement', source: 'manual', expensePlaidTransactionId: 'out', expenseManualTransactionId: null, incomePlaidTransactionId: null, incomeManualTransactionId: null, amount: '100.00', note: null },
    ]
    const result = applyTransfers(feed, transfers)

    expect(find(result, 'out')).toMatchObject({ reimbursedAmount: 300, netAmount: 200 })
  })

  it('floors netAmount at zero when reimbursements exceed expense', () => {
    const transfers: Transfer[] = [
      { id: 'r1', kind: 'reimbursement', source: 'manual', expensePlaidTransactionId: 'out', expenseManualTransactionId: null, incomePlaidTransactionId: 'in', incomeManualTransactionId: null, amount: '600.00', note: null },
    ]
    const result = applyTransfers(feed, transfers)

    expect(find(result, 'out')).toMatchObject({ reimbursedAmount: 600, netAmount: 0 })
  })

  it('carries the expense category to the reimbursement income leg', () => {
    const catFeed = mergeFeed(plaidTxns, [], [{ id: 'o1', plaidTransactionId: 'out', categoryId: 'food', subcategoryId: null }] as unknown as import('@/types/domain').TransactionOverride[], [])
    const transfers: Transfer[] = [
      { id: 'r1', kind: 'reimbursement', source: 'manual', expensePlaidTransactionId: 'out', expenseManualTransactionId: null, incomePlaidTransactionId: 'in', incomeManualTransactionId: null, amount: '200.00', note: null },
    ]
    const result = applyTransfers(catFeed, transfers)

    expect(find(result, 'in').reimbursementCategoryId).toBe('food')
  })
})

// Every leg carries a snapshot of what it's linked to, because the sheets that display links are
// often handed a filtered slice of the feed (one account, one category) in which the counterpart
// isn't present. Resolved here, where the whole feed is in hand, so no caller has to look it up.
describe('link stamping', () => {
  const plaidTxns = [
    { transaction_id: 'flight', account_id: 'visa', amount: 2055.32, date: '2026-08-12', name: 'UNITED', merchant_name: 'United Airlines', pending: false },
    { transaction_id: 'payout', account_id: 'checking', amount: -2000, date: '2026-08-13', name: 'EXPENSIFY', merchant_name: 'Expensify', pending: false },
    { transaction_id: 'payout2', account_id: 'checking', amount: -55.32, date: '2026-08-20', name: 'EXPENSIFY', merchant_name: 'Expensify', pending: false },
    { transaction_id: 'lunch', account_id: 'checking', amount: 12, date: '2026-08-10', name: 'DELI', merchant_name: 'Deli', pending: false },
  ] as unknown as PlaidTransaction[]

  const feed = mergeFeed(plaidTxns, [], [], [])
  const find = (items: ReturnType<typeof mergeFeed>, id: string) => items.find((item) => item.id === id)!

  it('links both legs of a transfer to each other', () => {
    const transfers: Transfer[] = [
      { id: 't1', kind: 'account_transfer', source: 'manual', expensePlaidTransactionId: 'flight', expenseManualTransactionId: null, incomePlaidTransactionId: 'payout', incomeManualTransactionId: null, amount: '2055.32', note: null },
    ]
    const result = applyTransfers(feed, transfers)

    expect(find(result, 'flight').links).toEqual([
      { recordId: 't1', kind: 'account_transfer', itemId: 'payout', merchantName: 'Expensify', date: '2026-08-13', accountId: 'checking', amount: 2055.32 },
    ])
    expect(find(result, 'payout').links).toEqual([
      { recordId: 't1', kind: 'account_transfer', itemId: 'flight', merchantName: 'United Airlines', date: '2026-08-12', accountId: 'visa', amount: 2055.32 },
    ])
  })

  it('gives an unpaired transfer a link with no counterpart, so the sheet can say so', () => {
    const transfers: Transfer[] = [
      { id: 't1', kind: 'credit_card_payment', source: 'auto', expensePlaidTransactionId: 'flight', expenseManualTransactionId: null, incomePlaidTransactionId: null, incomeManualTransactionId: null, amount: '2055.32', note: null },
    ]
    const result = applyTransfers(feed, transfers)

    expect(find(result, 'flight').links).toEqual([
      { recordId: 't1', kind: 'credit_card_payment', itemId: null, merchantName: null, date: null, accountId: null, amount: 2055.32 },
    ])
  })

  it('treats a counterpart outside the loaded window as unpaired rather than dropping the link', () => {
    const transfers: Transfer[] = [
      { id: 't1', kind: 'account_transfer', source: 'manual', expensePlaidTransactionId: 'flight', expenseManualTransactionId: null, incomePlaidTransactionId: 'not-loaded', incomeManualTransactionId: null, amount: '2055.32', note: null },
    ]
    const result = applyTransfers(feed, transfers)

    expect(find(result, 'flight').links).toMatchObject([{ recordId: 't1', itemId: null, merchantName: null }])
  })

  it('links an expense to every reimbursement paid against it, each with its own amount', () => {
    const transfers: Transfer[] = [
      { id: 'r1', kind: 'reimbursement', source: 'manual', expensePlaidTransactionId: 'flight', expenseManualTransactionId: null, incomePlaidTransactionId: 'payout', incomeManualTransactionId: null, amount: '2000.00', note: null },
      { id: 'r2', kind: 'reimbursement', source: 'manual', expensePlaidTransactionId: 'flight', expenseManualTransactionId: null, incomePlaidTransactionId: 'payout2', incomeManualTransactionId: null, amount: '55.32', note: null },
    ]
    const result = applyTransfers(feed, transfers)

    expect(find(result, 'flight').links).toEqual([
      { recordId: 'r1', kind: 'reimbursement', itemId: 'payout', merchantName: 'Expensify', date: '2026-08-13', accountId: 'checking', amount: 2000 },
      { recordId: 'r2', kind: 'reimbursement', itemId: 'payout2', merchantName: 'Expensify', date: '2026-08-20', accountId: 'checking', amount: 55.32 },
    ])
    // Each income leg knows only about its own link back to the expense.
    expect(find(result, 'payout').links).toMatchObject([{ recordId: 'r1', itemId: 'flight', amount: 2000 }])
    expect(find(result, 'payout2').links).toMatchObject([{ recordId: 'r2', itemId: 'flight', amount: 55.32 }])
  })

  it('leaves unlinked transactions with an empty list', () => {
    expect(find(mergeFeed(plaidTxns, [], [], []), 'lunch').links).toEqual([])
    expect(find(applyTransfers(feed, []), 'lunch').links).toEqual([])
  })
})

const investmentRow = (over: Partial<InvestmentTransaction> = {}): InvestmentTransaction => ({
  investmentTransactionId: 'itx-1',
  accountId: 'acc-ira',
  date: '2026-02-03',
  name: 'ACH Deposit',
  amount: -1000,
  subtype: 'contribution',
  ...over,
})

describe('mergeFeed with investment transactions', () => {
  const accounts = [{ account_id: 'acc-ira', type: 'investment', subtype: 'ira' }]

  it('maps an investment transaction into a feed item', () => {
    const feed = mergeFeed([], [], [], [], [], accounts, [investmentRow()])

    expect(feed).toHaveLength(1)
    expect(feed[0]).toMatchObject({
      id: 'itx-1',
      source: 'investment',
      amount: -1000,
      date: '2026-02-03',
      merchantName: 'ACH Deposit',
      accountId: 'acc-ira',
      pending: false,
      pfcDetailed: null,
      isBrokerageCashAccount: true,
    })
  })

  it('preserves Plaid\'s sign convention without flipping it', () => {
    // Positive = cash debited = money out, identical to the feed convention. A withdrawal is the
    // positive case now that trades are filtered out at the source.
    const wd = mergeFeed([], [], [], [], [], accounts, [investmentRow({ amount: 1000, subtype: 'withdrawal' })])
    expect(wd[0].amount).toBe(1000)
  })


  it('displays the institution description', () => {
    const feed = mergeFeed([], [], [], [], [], accounts, [investmentRow({ name: 'Wire Transfer In' })])
    expect(feed[0].merchantName).toBe('Wire Transfer In')
  })

  it('honours a user override on an investment transaction', () => {
    const overrides = [{ plaidTransactionId: 'itx-1', categoryId: 'cat-invest', subcategoryId: null }]
    const feed = mergeFeed([], [], overrides as never, [], [], accounts, [investmentRow()])
    expect(feed[0]).toMatchObject({ categoryId: 'cat-invest', categorySource: 'override' })
  })

  it('sorts investment rows into the same newest-first order as the rest of the feed', () => {
    const feed = mergeFeed([], [], [], [], [], accounts, [
      investmentRow({ investmentTransactionId: 'old', date: '2026-01-01' }),
      investmentRow({ investmentTransactionId: 'new', date: '2026-08-01' }),
    ])
    expect(feed.map((i) => i.id)).toEqual(['new', 'old'])
  })


})

describe('mergeFeed date basis', () => {
  // Plaid's `date` is the POSTED date for settled transactions; `authorized_date` is the day the
  // user actually made the transaction. The feed displays the latter and matches on the former —
  // see the FeedItem.postedDate doc comment for why the two roles are split.
  const plaidTxn = (over: Record<string, unknown>) =>
    [
      {
        transaction_id: 'p1',
        account_id: 'acc-1',
        amount: 35.5,
        name: 'PANDA EXPRESS #123',
        merchant_name: 'Panda Express',
        pending: false,
        personal_finance_category: null,
        ...over,
      },
    ] as unknown as PlaidTransaction[]

  it('shows authorized_date as the item date when Plaid supplies one', () => {
    const feed = mergeFeed(plaidTxn({ date: '2026-06-23', authorized_date: '2026-06-21' }), [], [], [])
    expect(feed[0].date).toBe('2026-06-21')
  })

  it('carries the posted date as postedDate even when authorized_date is earlier', () => {
    const feed = mergeFeed(plaidTxn({ date: '2026-06-23', authorized_date: '2026-06-21' }), [], [], [])
    expect(feed[0].postedDate).toBe('2026-06-23')
  })

  it('falls back to the posted date for both fields when authorized_date is null', () => {
    const feed = mergeFeed(plaidTxn({ date: '2026-06-23', authorized_date: null }), [], [], [])
    expect(feed[0]).toMatchObject({ date: '2026-06-23', postedDate: '2026-06-23' })
  })

  it('falls back to the posted date when authorized_date is absent entirely', () => {
    // FinanceKit rows predating the authorized_date wiring, and every cached row written before
    // it, arrive with the property missing rather than null.
    const feed = mergeFeed(plaidTxn({ date: '2026-06-23' }), [], [], [])
    expect(feed[0]).toMatchObject({ date: '2026-06-23', postedDate: '2026-06-23' })
  })

  it('places a month-straddling charge in the month it was authorized', () => {
    const feed = mergeFeed(plaidTxn({ date: '2026-07-01', authorized_date: '2026-06-30' }), [], [], [])
    expect(feed[0].date.startsWith('2026-06')).toBe(true)
  })

  it('gives manual transactions the same date and postedDate', () => {
    const manual = [
      { id: 'm1', amount: '5.00', type: 'expense', categoryId: null, subcategoryId: null, date: '2026-06-20', note: 'Cash' },
    ] as ManualTransaction[]
    const feed = mergeFeed([], manual, [], [])
    expect(feed[0]).toMatchObject({ date: '2026-06-20', postedDate: '2026-06-20' })
  })

  it('gives investment transactions the same date and postedDate', () => {
    const investments = [
      { investmentTransactionId: 'i1', accountId: 'acc-9', amount: 500, date: '2026-06-18', name: 'CASH TRANSFER' },
    ] as unknown as InvestmentTransaction[]
    const feed = mergeFeed([], [], [], [], [], [], investments)
    expect(feed[0]).toMatchObject({ date: '2026-06-18', postedDate: '2026-06-18' })
  })
})
