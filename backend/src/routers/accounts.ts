import { z } from 'zod'
import { protectedProcedure, router } from '../trpc/trpc.js'
import { plaidCredentialRepository } from '../repositories/plaidCredentialRepository.js'
import { plaidItemRepository } from '../repositories/plaidItemRepository.js'
import { createPlaidClient } from '../lib/plaid/client.js'
import { plaidItemErrorDetail } from '../lib/plaid/errors.js'
import { accountRepository } from '../repositories/accountRepository.js'
import { preconditionError } from '../trpc/errors.js'
import { resolveInstitutionLogo } from '../lib/plaid/fallbackLogos.js'

export const accountsRouter = router({
  list: protectedProcedure.query(async ({ ctx }) => {
    const creds = await plaidCredentialRepository.getDecrypted(ctx.userId)
    if (!creds) throw preconditionError('No Plaid credentials saved for this user.')
    const client = createPlaidClient(creds.clientId, creds.secret, creds.environment)
    const items = await plaidItemRepository.listDecryptedTokens(ctx.userId)

    // One Plaid round-trip per institution, all in flight at once — this query is the root of
    // the transaction feed and gates the app's first paint, and serially it cost
    // items.length × RTT. Results are collected per item and flattened in item order below,
    // so parallelism never reorders the account list.
    const results = await Promise.all(
      items.map(async (item) => {
        // Lazy logo backfill for items linked before institution logos were stored. NULL means
        // never fetched; one fetch resolves it to the logo or '' (institution has none), so
        // logo-less banks are never re-queried. Best-effort: a failure just leaves it NULL for
        // the next list to retry.
        //
        // This makes `list` a query with a side effect, which the frontend's fetchWithNetworkRetry
        // (lib/api/client.ts) doesn't know about — it retries any GET whose fetch() rejected,
        // on the assumption that a GET is a pure read. A lost-response retry here re-runs this
        // Plaid call and the write below a second time. Accepted rather than special-cased: the
        // write converges to the same institution logo either time (last-write-wins is fine for
        // a value that isn't computed from anything but Plaid's own current answer), so the only
        // real cost is one duplicate Plaid call on an already-rare race — cheaper than plumbing
        // per-procedure retry-safety through a link that batches multiple procedures per request.
        let institutionLogo = item.institutionLogo
        if (institutionLogo === null) {
          try {
            const res = await client.institutionsGetById({
              institution_id: item.institutionId,
              country_codes: ['US'],
              options: { include_optional_metadata: true },
            } as never)
            institutionLogo = ((res.data.institution.logo as string | null) ?? '')
            await plaidItemRepository.updateLogo(ctx.userId, item.itemId, institutionLogo)
          } catch {
            institutionLogo = ''
          }
        }

        // One broken item (revoked access, ITEM_LOGIN_REQUIRED, keys that no longer match the
        // token) must not take down the whole query — this is the root of the transaction feed,
        // so throwing here blanks the dashboard, transactions and net worth at once. Mirrors the
        // per-item isolation transactionSyncService already applies.
        try {
          const itemAccounts = (await accountRepository.get(client, item.accessToken)).map((account) => ({
            ...account,
            itemId: item.itemId,
            institutionName: item.institutionName,
            institutionLogo: resolveInstitutionLogo(item.institutionId, institutionLogo),
          }))
          return { itemAccounts, itemError: null }
        } catch (err) {
          return {
            itemAccounts: [],
            itemError: {
              itemId: item.itemId,
              institutionName: item.institutionName,
              ...plaidItemErrorDetail(err, 'Could not load accounts for this institution.'),
            },
          }
        }
      }),
    )

    const accounts = results.flatMap((r) => r.itemAccounts)
    const itemErrors = results.flatMap((r) => (r.itemError ? [r.itemError] : []))
    return { accounts, itemErrors }
  }),

  listInstitutions: protectedProcedure.query(async ({ ctx }) => {
    return plaidItemRepository.list(ctx.userId)
  }),

  // Reversible disconnect: syncing stops and the accounts leave every screen, but the Item
  // survives at Plaid so reconnecting costs nothing. This is the default because revoking is a
  // one-way door — Plaid trial plans count Items created for all time, and /item/remove does not
  // give the allowance back, so a remove/re-add round trip permanently spends two.
  disconnectInstitution: protectedProcedure
    .input(z.object({ itemId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      await plaidItemRepository.setDisabled(ctx.userId, input.itemId, true)
    }),

  reconnectInstitution: protectedProcedure
    .input(z.object({ itemId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      await plaidItemRepository.setDisabled(ctx.userId, input.itemId, false)
    }),

  // Permanent: revokes at Plaid, so the access token is gone for good and getting this
  // institution back means a new Item. disconnectInstitution is the reversible alternative.
  removeInstitution: protectedProcedure
    .input(z.object({ itemId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const creds = await plaidCredentialRepository.getDecrypted(ctx.userId)
      if (creds) {
        const client = createPlaidClient(creds.clientId, creds.secret, creds.environment)
        // getDecryptedToken, not listDecryptedTokens: an already-disconnected institution is
        // exactly what gets deleted permanently, and the list view hides those.
        const item = await plaidItemRepository.getDecryptedToken(ctx.userId, input.itemId)
        if (item) {
          try {
            await client.itemRemove({ access_token: item.accessToken })
          } catch {
            // If Plaid rejects (e.g. already removed), still delete locally
          }
        }
      }
      await plaidItemRepository.delete(ctx.userId, input.itemId)
    }),
})
