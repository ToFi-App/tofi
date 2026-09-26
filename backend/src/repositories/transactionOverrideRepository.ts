import { getScopedClient } from '../lib/supabase/scopedClient.js'

export interface TransactionOverride {
  id: string
  plaidTransactionId: string
  categoryId: string | null
  subcategoryId: string | null
  note: string | null
}

function fromRow(row: { id: string; plaid_transaction_id: string; category_id: string | null; subcategory_id: string | null; note: string | null }): TransactionOverride {
  return { id: row.id, plaidTransactionId: row.plaid_transaction_id, categoryId: row.category_id, subcategoryId: row.subcategory_id, note: row.note }
}

export const transactionOverrideRepository = {
  async list(jwt: string): Promise<TransactionOverride[]> {
    const client = getScopedClient(jwt)
    const { data, error } = await client.from('transaction_overrides').select('id, plaid_transaction_id, category_id, subcategory_id, note')
    if (error) throw error
    return data.map(fromRow)
  },

  async upsert(
    jwt: string,
    userId: string,
    input: { plaidTransactionId: string; categoryId: string | null; subcategoryId: string | null; note: string | null },
  ): Promise<TransactionOverride> {
    const client = getScopedClient(jwt)
    const { data, error } = await client
      .from('transaction_overrides')
      .upsert(
        { user_id: userId, plaid_transaction_id: input.plaidTransactionId, category_id: input.categoryId, subcategory_id: input.subcategoryId, note: input.note },
        { onConflict: 'user_id,plaid_transaction_id' },
      )
      .select('id, plaid_transaction_id, category_id, subcategory_id, note')
      .single()
    if (error) throw error
    return fromRow(data)
  },

  async delete(jwt: string, id: string): Promise<void> {
    const client = getScopedClient(jwt)
    const { error } = await client.from('transaction_overrides').delete().eq('id', id)
    if (error) throw error
  },

  async migrateTransactionIds(jwt: string, migrations: Array<{ oldId: string; newId: string }>): Promise<number> {
    const client = getScopedClient(jwt)
    let migrated = 0
    for (const { oldId, newId } of migrations) {
      const { count, error } = await client
        .from('transaction_overrides')
        .update({ plaid_transaction_id: newId })
        .eq('plaid_transaction_id', oldId)
      if (error) throw error
      if (count) migrated += count
    }
    return migrated
  },
}
