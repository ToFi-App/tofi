import { z } from 'zod'
import { publicProcedure, router } from '../trpc/trpc.js'
import { observabilityService } from '../services/observabilityService.js'

export const observabilityRouter = router({
  /**
   * The frontend's one way to report a failure nobody would otherwise see. Public, not
   * protected: the most important case this exists for — an auth failure — by definition has
   * no session, so a protected procedure could never receive it. Public doesn't mean anonymous
   * though: createContext resolves ctx.userId from the bearer token whenever one is present,
   * independent of whether the procedure requires it — see observabilityService for how that's
   * used to attribute a report from a still-signed-in user rather than treating them as
   * unverified.
   *
   * Deliberately minimal input. No free-form detail blob: that would make this a second path
   * for financial data to reach a log line, which is exactly the boundary
   * trpc/errorLogging.ts's redaction already exists to hold.
   */
  reportClientError: publicProcedure
    .input(
      z.object({
        scope: z.string().min(1).max(100),
        message: z.string().min(1).max(500),
        name: z.string().max(100).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await observabilityService.reportClientError(ctx.userId, input)
      return { ok: true }
    }),
})
