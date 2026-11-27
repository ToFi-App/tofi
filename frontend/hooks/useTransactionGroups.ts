import { useMemo } from 'react'
import { api } from '@/lib/api/client'
import { groupIdByItemId } from '@/lib/groups/groups'
import type { TransactionGroup, TransactionGroupMember } from '@/types/domain'

const NO_GROUPS: TransactionGroup[] = []
const NO_MEMBERS: TransactionGroupMember[] = []

/**
 * Transaction groups and their members (docs/transaction-groups.md), plus the lookups every
 * surface needs. Every write invalidates the one list query rather than patching it: groups are
 * few, and the list returns groups and members together, so a refetch is cheap and can't leave
 * the two halves disagreeing.
 */
export function useTransactionGroups() {
  const utils = api.useUtils()
  const query = api.transactionGroups.list.useQuery()
  const invalidate = () => utils.transactionGroups.list.invalidate()

  const create = api.transactionGroups.create.useMutation({ onSuccess: invalidate })
  const update = api.transactionGroups.update.useMutation({ onSuccess: invalidate })
  const remove = api.transactionGroups.delete.useMutation({ onSuccess: invalidate })
  const resolve = api.transactionGroups.resolve.useMutation({ onSuccess: invalidate })
  const reopen = api.transactionGroups.reopen.useMutation({ onSuccess: invalidate })
  const addMembers = api.transactionGroups.addMembers.useMutation({ onSuccess: invalidate })
  const removeMembers = api.transactionGroups.removeMembers.useMutation({ onSuccess: invalidate })

  const groups = query.data?.groups ?? NO_GROUPS
  const members = query.data?.members ?? NO_MEMBERS
  const groupById = useMemo(() => new Map(groups.map((g) => [g.id, g])), [groups])
  const groupIdByItem = useMemo(() => groupIdByItemId(members), [members])

  return {
    groups,
    members,
    groupById,
    /** Feed id → group id, for the row pill and the editor's Group field. */
    groupIdByItem,
    isLoading: query.isLoading,
    error: query.error,
    isSaving:
      create.isLoading || update.isLoading || remove.isLoading || resolve.isLoading ||
      reopen.isLoading || addMembers.isLoading || removeMembers.isLoading,
    create: create.mutateAsync,
    update: update.mutateAsync,
    delete: remove.mutateAsync,
    resolve: resolve.mutateAsync,
    reopen: reopen.mutateAsync,
    addMembers: addMembers.mutateAsync,
    removeMembers: removeMembers.mutateAsync,
  }
}
