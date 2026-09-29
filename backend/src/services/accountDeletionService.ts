import { accountDeletionRepository } from '../repositories/accountDeletionRepository.js'
import { plaidCredentialRepository } from '../repositories/plaidCredentialRepository.js'
import { plaidItemRepository } from '../repositories/plaidItemRepository.js'
import { createPlaidClient } from '../lib/plaid/client.js'
import { getServiceClient } from '../lib/supabase/serviceClient.js'

/**
 * Revokes every Plaid Item the user has, so the access tokens we are about to destroy stop
 * working at Plaid too. Deleting only our rows would leave live Items behind that the user
 * can neither see nor revoke.
 *
 * Best-effort by design: a token already revoked, a rotated secret, or Plaid being down must
 * not block the deletion the user asked for. Apple requires the account to go, and stranding
 * someone in a half-deleted state because a third party is unreachable is the worse failure.
 */
async function revokePlaidItems(userId: string): Promise<void> {
  const credentials = await plaidCredentialRepository.getDecrypted(userId)
  if (!credentials) return

  const items = await plaidItemRepository.listAllDecryptedTokens(userId)
  if (items.length === 0) return

  const client = createPlaidClient(credentials.clientId, credentials.secret, credentials.environment)
  for (const item of items) {
    try {
      await client.itemRemove({ access_token: item.accessToken })
    } catch {
      // Already revoked, credentials rotated, or Plaid unreachable — the local rows still go.
    }
  }
}

export const accountDeletionService = {
  /**
   * Deletes the user's account and everything attached to it.
   *
   * Order is deliberate. Plaid revocation runs first because it needs the access tokens that
   * the row delete destroys. The auth user goes last because it is the one step we cannot undo
   * and cannot retry — while it exists the user can sign in and ask again, so a failure
   * anywhere earlier leaves a recoverable state rather than an orphaned login.
   */
  async deleteAccount(userId: string): Promise<{ deleted: true }> {
    await revokePlaidItems(userId)
    await accountDeletionRepository.deleteAllUserData(userId)

    const { error } = await getServiceClient().auth.admin.deleteUser(userId)
    // Cause kept, not just the message: this is the one step that isn't retried or undone, so
    // whether it failed because Supabase's admin API is genuinely down (networkErrorOf reads
    // this in errorLogging.ts) versus a real rejection matters for whoever has to follow up.
    if (error) throw new Error(`Could not delete the account: ${error.message}`, { cause: error })

    return { deleted: true }
  },
}
