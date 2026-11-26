import { getScopedClient } from '../lib/supabase/scopedClient.js'

// Transaction groups (docs/transaction-groups.md): a named set of transactions plus the user's
// "resolved" flag. Everything a screen shows about a group — totals, dates, which rows are
// expenses — is derived on the client from the feed, so this layer only moves ids around.

export interface TransactionGroup {
  id: string
  name: string
  color: string
  icon: string | null
  /** ISO timestamp; null while the group is active. */
  resolvedAt: string | null
  createdAt: string
}

export interface TransactionGroupMember {
  id: string
  groupId: string
  plaidTransactionId: string | null
  manualTransactionId: string | null
}

/** Exactly one of the two is set — the same leg shape `transfers` uses. */
export interface MemberRef {
  plaidTransactionId: string | null
  manualTransactionId: string | null
}

export interface GroupInput {
  name: string
  color: string
  icon: string | null
}

const GROUP_COLUMNS = 'id, name, color, icon, resolved_at, created_at'
const MEMBER_COLUMNS = 'id, group_id, plaid_transaction_id, manual_transaction_id'

function groupFromRow(row: {
  id: string
  name: string
  color: string
  icon: string | null
  resolved_at: string | null
  created_at: string
}): TransactionGroup {
  return {
    id: row.id,
    name: row.name,
    color: row.color,
    icon: row.icon,
    resolvedAt: row.resolved_at,
    createdAt: row.created_at,
  }
}

function memberFromRow(row: {
  id: string
  group_id: string
  plaid_transaction_id: string | null
  manual_transaction_id: string | null
}): TransactionGroupMember {
  return {
    id: row.id,
    groupId: row.group_id,
    plaidTransactionId: row.plaid_transaction_id,
    manualTransactionId: row.manual_transaction_id,
  }
}

/** Postgres unique_violation: a transaction is already in a group (the partial-unique backstop). */
export function isUniqueViolation(error: unknown): boolean {
  return (error as { code?: string })?.code === '23505'
}

export const transactionGroupRepository = {
  async list(jwt: string): Promise<{ groups: TransactionGroup[]; members: TransactionGroupMember[] }> {
    const client = getScopedClient(jwt)
    const [groupsRes, membersRes] = await Promise.all([
      client.from('transaction_groups').select(GROUP_COLUMNS).order('created_at', { ascending: false }),
      client.from('transaction_group_members').select(MEMBER_COLUMNS),
    ])
    if (groupsRes.error) throw groupsRes.error
    if (membersRes.error) throw membersRes.error
    return { groups: groupsRes.data.map(groupFromRow), members: membersRes.data.map(memberFromRow) }
  },

  /** The group if the caller owns it, else null — RLS makes foreign and nonexistent look the same. */
  async findById(jwt: string, id: string): Promise<TransactionGroup | null> {
    const client = getScopedClient(jwt)
    const { data, error } = await client.from('transaction_groups').select(GROUP_COLUMNS).eq('id', id).maybeSingle()
    if (error) throw error
    return data ? groupFromRow(data) : null
  },

  async create(jwt: string, userId: string, input: GroupInput): Promise<TransactionGroup> {
    const client = getScopedClient(jwt)
    const { data, error } = await client
      .from('transaction_groups')
      .insert({ user_id: userId, name: input.name, color: input.color, icon: input.icon })
      .select(GROUP_COLUMNS)
      .single()
    if (error) throw error
    return groupFromRow(data)
  },

  async update(jwt: string, id: string, patch: Partial<GroupInput>): Promise<TransactionGroup> {
    const client = getScopedClient(jwt)
    const { data, error } = await client
      .from('transaction_groups')
      .update({ ...patch, updated_at: new Date().toISOString() })
      .eq('id', id)
      .select(GROUP_COLUMNS)
      .single()
    if (error) throw error
    return groupFromRow(data)
  },

  /** Sets or clears resolved_at. Resolving twice keeps the first timestamp's meaning: "resolved". */
  async setResolved(jwt: string, id: string, resolved: boolean): Promise<TransactionGroup> {
    const client = getScopedClient(jwt)
    const now = new Date().toISOString()
    const { data, error } = await client
      .from('transaction_groups')
      .update({ resolved_at: resolved ? now : null, updated_at: now })
      .eq('id', id)
      .select(GROUP_COLUMNS)
      .single()
    if (error) throw error
    return groupFromRow(data)
  },

  /** Deletes the group; its member rows cascade. The transactions themselves are untouched. */
  async delete(jwt: string, id: string): Promise<void> {
    const client = getScopedClient(jwt)
    const { error } = await client.from('transaction_groups').delete().eq('id', id)
    if (error) throw error
  },

  /**
   * Inserts every ref in one statement, so a conflict on any of them adds none: the picker shows
   * the whole selection as added or nothing, never a silent partial. A unique violation (some
   * transaction already in a group) is rethrown as-is for the router to turn into a CONFLICT.
   */
  async addMembers(jwt: string, userId: string, groupId: string, refs: MemberRef[]): Promise<TransactionGroupMember[]> {
    if (refs.length === 0) return []
    const client = getScopedClient(jwt)
    const { data, error } = await client
      .from('transaction_group_members')
      .insert(
        refs.map((ref) => ({
          user_id: userId,
          group_id: groupId,
          plaid_transaction_id: ref.plaidTransactionId,
          manual_transaction_id: ref.manualTransactionId,
        })),
      )
      .select(MEMBER_COLUMNS)
    if (error) throw error
    return data.map(memberFromRow)
  },

  /** Scoped to the group so a stale member id from another group can't be removed through it. */
  async removeMembers(jwt: string, groupId: string, memberIds: string[]): Promise<void> {
    if (memberIds.length === 0) return
    const client = getScopedClient(jwt)
    const { error } = await client
      .from('transaction_group_members')
      .delete()
      .eq('group_id', groupId)
      .in('id', memberIds)
    if (error) throw error
  },

  /** Pending-to-posted: repoints members at the posted id, alongside overrides and transfers. */
  async migrateTransactionIds(jwt: string, migrations: Array<{ oldId: string; newId: string }>): Promise<void> {
    const client = getScopedClient(jwt)
    for (const { oldId, newId } of migrations) {
      const { error } = await client
        .from('transaction_group_members')
        .update({ plaid_transaction_id: newId })
        .eq('plaid_transaction_id', oldId)
      if (error) throw error
    }
  },

}
