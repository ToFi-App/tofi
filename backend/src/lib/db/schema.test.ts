import { describe, expect, it } from 'vitest'
import * as schema from './schema.js'

describe('schema', () => {
  it('exports every table required by architecture.md', () => {
    const tableNames = [
      'plaidCredentials',
      'plaidItems',
      'categories',
      'subcategories',
      'plaidCategoryMappings',
      'vendorMappings',
      'manualTransactions',
      'transactionOverrides',
      'budgets',
      'transfers',
      'transferDismissals',
      'transactionGroups',
      'transactionGroupMembers',
    ] as const
    for (const name of tableNames) {
      expect(schema[name]).toBeDefined()
    }
  })

  it('gives categories a color and icon column', () => {
    expect(schema.categories.color).toBeDefined()
    expect(schema.categories.icon).toBeDefined()
  })

  // The original `reimbursements` table was dropped in 0007: reimbursements are rows in
  // `transfers` with kind = 'reimbursement', and have been since 0003.
  it('no longer exports a reimbursements table', () => {
    expect('reimbursements' in schema).toBe(false)
  })

  it('gives transfers the four linkage columns plus a kind discriminator', () => {
    expect(schema.transfers.expensePlaidTransactionId).toBeDefined()
    expect(schema.transfers.expenseManualTransactionId).toBeDefined()
    expect(schema.transfers.incomePlaidTransactionId).toBeDefined()
    expect(schema.transfers.incomeManualTransactionId).toBeDefined()
    expect(schema.transfers.kind).toBeDefined()
  })

  it('gives transfers a source discriminator defaulting to manual', () => {
    expect(schema.transfers.source).toBeDefined()
    expect(schema.transfers.source.default).toBe('manual')
  })

  it('gives transfer_dismissals its expense leg key', () => {
    expect(schema.transferDismissals.expensePlaidTransactionId).toBeDefined()
    expect(schema.transferDismissals.userId).toBeDefined()
  })
})
