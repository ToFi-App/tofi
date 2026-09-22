import { initTRPC, TRPCError } from '@trpc/server'
import type { Context } from './context.js'
import { redactInternalMessage } from './errorLogging.js'

const t = initTRPC.context<Context>().create({
  // Anything that isn't a deliberate TRPCError reaches the client as INTERNAL_SERVER_ERROR
  // carrying the raw failure text. The full detail goes to the server log instead (logTrpcError).
  errorFormatter: ({ shape, error }) => redactInternalMessage(shape, error.code),
})

export const router = t.router
export const publicProcedure = t.procedure

export const protectedProcedure = t.procedure.use(({ ctx, next }) => {
  if (!ctx.userId || !ctx.jwt) {
    // message is set explicitly rather than left to TRPCError's own cause?.message fallback:
    // ctx.authError (a missing/invalid token) is not itself the message a client should see,
    // and TRPCError otherwise surfaces a cause's raw message verbatim for any code but
    // INTERNAL_SERVER_ERROR (redactInternalMessage only redacts that one). The cause is kept for
    // logging (errorLogging.ts's networkErrorOf reads it) without changing what the client gets.
    throw new TRPCError({ code: 'UNAUTHORIZED', message: 'UNAUTHORIZED', cause: ctx.authError ?? undefined })
  }
  // email stays nullable past this point: authentication does not guarantee an email claim.
  return next({ ctx: { userId: ctx.userId, email: ctx.email ?? null, jwt: ctx.jwt } })
})
