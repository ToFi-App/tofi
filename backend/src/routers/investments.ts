import { z } from 'zod'
import { protectedProcedure, router } from '../trpc/trpc.js'
import { plaidCredentialRepository } from '../repositories/plaidCredentialRepository.js'
import { plaidItemRepository } from '../repositories/plaidItemRepository.js'
import { createPlaidClient } from '../lib/plaid/client.js'
import { investmentRepository } from '../repositories/investmentRepository.js'
import { investmentTransactionService } from '../services/investmentTransactionService.js'
import { notFoundError, preconditionError } from '../trpc/errors.js'
import { AlpacaRateLimitError, alpacaClientFromEnv } from '../lib/alpaca/client.js'
import { TRPCError } from '@trpc/server'

/** YYYY-MM-DD, the only date format Plaid's investments endpoints accept. */
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected YYYY-MM-DD')

/**
 * What Alpaca accepts as an equity symbol ("AAPL", "BRK.B"). Checked here because one malformed
 * symbol — Plaid's "CUR:USD" cash line, say — fails Alpaca's whole multi-symbol request.
 */
const alpacaSymbol = z.string().regex(/^[A-Z][A-Z0-9.]{0,9}$/, 'Not an Alpaca equity symbol')

/** The user's Plaid client and one of their items' tokens; rejects an item that isn't theirs. */
async function resolveItem(userId: string, itemId: string) {
  const creds = await plaidCredentialRepository.getDecrypted(userId)
  if (!creds) throw preconditionError('No Plaid credentials saved for this user.')
  const client = createPlaidClient(creds.clientId, creds.secret, creds.environment)

  const items = await plaidItemRepository.listDecryptedTokens(userId)
  const item = items.find((i) => i.itemId === itemId)
  if (!item) throw notFoundError('This account is not linked to your profile.')

  return { client, accessToken: item.accessToken }
}

export const investmentsRouter = router({
  // Holdings for one investment account. Fetched on demand when the account's detail sheet
  // opens (not with accounts.list): holdings calls are per-item and comparatively slow, and
  // most sessions never open an investment account.
  holdings: protectedProcedure
    .input(z.object({ itemId: z.string().min(1), accountId: z.string().min(1) }))
    .query(async ({ ctx, input }) => {
      const { client, accessToken } = await resolveItem(ctx.userId, input.itemId)
      return investmentRepository.getHoldings(client, accessToken, input.accountId)
    }),

  // One account's FULL activity, trades included, for rebuilding its past positions. Fetched with
  // holdings when the detail sheet opens. Never merged into transactions above: those rows feed
  // transfer pairing and spend totals, where a trade would read as spending.
  activity: protectedProcedure
    .input(z.object({ itemId: z.string().min(1), accountId: z.string().min(1), startDate: isoDate, endDate: isoDate }))
    .query(async ({ ctx, input }) => {
      const { client, accessToken } = await resolveItem(ctx.userId, input.itemId)
      return investmentRepository.getAccountActivity(client, accessToken, input.accountId, input.startDate, input.endDate)
    }),

  // Item-wide, unlike holdings above: these rows feed transfer pairing across ALL accounts,
  // so the client needs every item's activity on every sync, not one account's on sheet open.
  transactions: protectedProcedure
    .input(z.object({ startDate: isoDate, endDate: isoDate }))
    .query(({ ctx, input }) => investmentTransactionService.fetch(ctx.userId, input.startDate, input.endDate)),

  // Raw daily closes plus the splits needed to adjust them, relayed from Alpaca and never stored
  // here — the device caches settled months forever (see useInvestmentPriceHistory). Splits run
  // from `splitsSince` through today rather than over the bars' range: the client multiplies
  // closes from months it already holds by today's share count, which is post every split since.
  priceHistory: protectedProcedure
    .input(
      z.object({
        symbols: z.array(alpacaSymbol).min(1).max(100),
        startDate: isoDate,
        endDate: isoDate,
        splitsSince: isoDate.optional(),
      }),
    )
    .query(async ({ input }) => {
      const alpaca = alpacaClientFromEnv()
      const today = new Date().toISOString().slice(0, 10)
      try {
        const [closes, splits] = await Promise.all([
          alpaca.getDailyCloses(input.symbols, input.startDate, input.endDate),
          alpaca.getSplits(input.symbols, input.splitsSince ?? input.startDate, today),
        ])
        return { closes, splits }
      } catch (err) {
        throw asTrpcRateLimit(err)
      }
    }),

  // Each symbol's latest trade, relayed from Alpaca and never stored. The client multiplies these by
  // Plaid's share counts when they're newer than the institution's own price (see livePricing).
  latestPrices: protectedProcedure
    .input(z.object({ symbols: z.array(alpacaSymbol).min(1).max(100) }))
    .query(async ({ input }) => {
      try {
        return await alpacaClientFromEnv().getLatestPrices(input.symbols)
      } catch (err) {
        throw asTrpcRateLimit(err)
      }
    }),
})

/** An exhausted Alpaca quota as TOO_MANY_REQUESTS, keeping the wait for the error formatter. */
function asTrpcRateLimit(err: unknown): unknown {
  if (!(err instanceof AlpacaRateLimitError)) return err
  return new TRPCError({ code: 'TOO_MANY_REQUESTS', message: 'Market data is busy. Retrying shortly.', cause: err })
}
