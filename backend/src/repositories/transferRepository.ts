import { getScopedClient } from '../lib/supabase/scopedClient.js'
import type { TransferKind, TransferSource } from '../lib/transfers/kinds.js'

export interface Transfer {
  id: string
  kind: TransferKind
  source: TransferSource
  expensePlaidTransactionId: string | null
  expenseManualTransactionId: string | null
  incomePlaidTransactionId: string | null
  incomeManualTransactionId: string | null
  amount: string
  note: string | null
}

export interface TransferInput {
  kind: TransferKind
  expensePlaidTransactionId: string | null
  expenseManualTransactionId: string | null
  incomePlaidTransactionId: string | null
  incomeManualTransactionId: string | null
  amount: string
  note: string | null
}

/**
 * Auto-detected transfers are narrower than manual ones: always Plaid legs, always paired
 * (detection never excludes a lone transaction), never carry a note.
 */
export interface AutoTransferInput {
  kind: TransferKind
  expensePlaidTransactionId: string
  incomePlaidTransactionId: string
  amount: string
}

export interface CreateManyResult {
  created: Transfer[]
  /** Rows whose leg was already in a transfer (unique-index conflict) — success, not retry. */
  skipped: number
  /** Rows rejected for any other reason. Best-effort: the pair simply stays counted. */
  failed: number
}

const COLUMNS =
  'id, kind, source, expense_plaid_transaction_id, expense_manual_transaction_id, income_plaid_transaction_id, income_manual_transaction_id, amount, note'

function exactlyOne(a: unknown, b: unknown): boolean {
  return (a !== null) !== (b !== null)
}

function atMostOne(a: unknown, b: unknown): boolean {
  return !(a !== null && b !== null)
}

function fromRow(row: {
  id: string
  kind: string
  source: string
  expense_plaid_transaction_id: string | null
  expense_manual_transaction_id: string | null
  income_plaid_transaction_id: string | null
  income_manual_transaction_id: string | null
  amount: string
  note: string | null
}): Transfer {
  return {
    id: row.id,
    kind: row.kind as TransferKind,
    source: row.source as TransferSource,
    expensePlaidTransactionId: row.expense_plaid_transaction_id,
    expenseManualTransactionId: row.expense_manual_transaction_id,
    incomePlaidTransactionId: row.income_plaid_transaction_id,
    incomeManualTransactionId: row.income_manual_transaction_id,
    amount: row.amount,
    note: row.note,
  }
}

/** Postgres unique_violation — some leg is already in a transfer (partial-unique backstop). */
function isUniqueViolation(error: unknown): boolean {
  return (error as { code?: string })?.code === '23505'
}

export const transferRepository = {
  async list(jwt: string): Promise<Transfer[]> {
    const client = getScopedClient(jwt)
    const { data, error } = await client.from('transfers').select(COLUMNS)
    if (error) throw error
    return data.map(fromRow)
  },

  async create(jwt: string, userId: string, input: TransferInput): Promise<Transfer> {
    if (!exactlyOne(input.expensePlaidTransactionId, input.expenseManualTransactionId)) {
      throw new Error('Exactly one of expensePlaidTransactionId/expenseManualTransactionId must be set')
    }
    // Unlike a reimbursement, a transfer may have no income leg at all — the destination
    // account isn't necessarily connected to the app.
    if (!atMostOne(input.incomePlaidTransactionId, input.incomeManualTransactionId)) {
      throw new Error('At most one of incomePlaidTransactionId/incomeManualTransactionId may be set')
    }

    const client = getScopedClient(jwt)
    const { data, error } = await client
      .from('transfers')
      .insert({
        user_id: userId,
        kind: input.kind,
        source: 'manual',
        expense_plaid_transaction_id: input.expensePlaidTransactionId,
        expense_manual_transaction_id: input.expenseManualTransactionId,
        income_plaid_transaction_id: input.incomePlaidTransactionId,
        income_manual_transaction_id: input.incomeManualTransactionId,
        amount: input.amount,
        note: input.note,
      })
      .select(COLUMNS)
      .single()
    if (error) throw error
    return fromRow(data)
  },

  /**
   * Bulk insert for auto-detected transfers, always source 'auto'. Rows are inserted
   * individually so one conflict can't fail the batch: PostgREST has no ON CONFLICT DO
   * NOTHING against partial unique indexes, and a multi-device race hitting
   * transfers_*_unique is expected — the row already existing IS the desired end state,
   * so a unique violation counts as skipped, never retried. Any other per-row failure is
   * reported, not thrown: auto-apply is best-effort and an unsaved pair just stays counted.
   */
  async createMany(jwt: string, userId: string, inputs: AutoTransferInput[]): Promise<CreateManyResult> {
    const client = getScopedClient(jwt)
    const created: Transfer[] = []
    let skipped = 0
    let failed = 0

    for (const input of inputs) {
      const { data, error } = await client
        .from('transfers')
        .insert({
          user_id: userId,
          kind: input.kind,
          source: 'auto',
          expense_plaid_transaction_id: input.expensePlaidTransactionId,
          expense_manual_transaction_id: null,
          income_plaid_transaction_id: input.incomePlaidTransactionId,
          income_manual_transaction_id: null,
          amount: input.amount,
          note: null,
        })
        .select(COLUMNS)
        .single()
      if (error) {
        if (isUniqueViolation(error)) skipped += 1
        else failed += 1
        continue
      }
      created.push(fromRow(data))
    }

    return { created, skipped, failed }
  },

  async delete(jwt: string, id: string): Promise<void> {
    const client = getScopedClient(jwt)
    const { error } = await client.from('transfers').delete().eq('id', id)
    if (error) throw error
  },

  async migrateTransactionIds(jwt: string, migrations: Array<{ oldId: string; newId: string }>): Promise<void> {
    const client = getScopedClient(jwt)
    for (const { oldId, newId } of migrations) {
      const { error: expenseErr } = await client
        .from('transfers')
        .update({ expense_plaid_transaction_id: newId })
        .eq('expense_plaid_transaction_id', oldId)
      if (expenseErr) throw expenseErr
      const { error: incomeErr } = await client
        .from('transfers')
        .update({ income_plaid_transaction_id: newId })
        .eq('income_plaid_transaction_id', oldId)
      if (incomeErr) throw incomeErr
    }
  },
}
