import { initTRPC, TRPCError } from '@trpc/server'
import type { Context } from './context.js'
import { redactInternalMessage } from './errorLogging.js'
import { AlpacaRateLimitError } from '../lib/alpaca/client.js'

const t = initTRPC.context<Context>().create({
  // Anything that isn't a deliberate TRPCError reaches the client as INTERNAL_SERVER_ERROR
  // carrying the raw failure text. The full detail goes to the server log instead (logTrpcError).
  //
  // A rate-limited error also carries how long to wait, so the client can retry once the quota
  // resets instead of guessing — the backend never sleeps on it (see AlpacaRateLimitError).
  errorFormatter: ({ shape, error }) => {
    const formatted = redactInternalMessage(shape, error.code)
    if (!(error.cause instanceof AlpacaRateLimitError)) return formatted
    return { ...formatted, data: { ...formatted.data, retryAfterSeconds: error.cause.retryAfterSeconds } }
  },
})

export const router = t.router
export const publicProcedure = t.procedure

export const protectedProcedure = t.procedure.use(({ ctx, next }) => {
  if (!ctx.userId || !ctx.jwt) {
    throw new TRPCError({ code: 'UNAUTHORIZED' })
  }
  // email stays nullable past this point: authentication does not guarantee an email claim.
  return next({ ctx: { userId: ctx.userId, email: ctx.email ?? null, jwt: ctx.jwt } })
})
