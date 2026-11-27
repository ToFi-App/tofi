/**
 * What a failed group write tells the user. Most failures are worth only "try again", but two are
 * setup problems the user can act on, and a generic message hid them:
 *  - the backend has no transactionGroups router (deployed from a branch without groups): tRPC
 *    answers NOT_FOUND "No procedure found";
 *  - the database is missing the tables (migration 0015 not applied): the router answers
 *    PRECONDITION_FAILED with a message saying so.
 */
export function describeGroupError(error: unknown, fallback: string): string {
  const err = error as { message?: string; data?: { code?: string } | null } | null
  const code = err?.data?.code
  const message = err?.message ?? ''
  if (code === 'NOT_FOUND' && /procedure on path|no procedure/i.test(message)) {
    return "This server doesn't support groups yet. Deploy the backend from the groups branch."
  }
  if (code === 'PRECONDITION_FAILED' && message) return message
  if (code === 'CONFLICT' && message) return message
  return fallback
}
