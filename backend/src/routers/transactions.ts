import { z } from 'zod'
import { protectedProcedure, router } from '../trpc/trpc.js'
import { transactionSyncService } from '../services/transactionSyncService.js'
import { transactionOverrideRepository } from '../repositories/transactionOverrideRepository.js'
import { transferRepository } from '../repositories/transferRepository.js'

const migrationEntry = z.object({ oldId: z.string().min(1), newId: z.string().min(1) })

export const transactionsRouter = router({
  sync: protectedProcedure
    .input(z.object({ cursors: z.record(z.string()) }))
    .mutation(({ ctx, input }) => {
      return transactionSyncService.sync(ctx.userId, input.cursors)
    }),

  migrateIds: protectedProcedure
    .input(z.object({ migrations: z.array(migrationEntry).min(1).max(500) }))
    .mutation(async ({ ctx, input }) => {
      await Promise.all([
        transactionOverrideRepository.migrateTransactionIds(ctx.jwt, input.migrations),
        transferRepository.migrateTransactionIds(ctx.jwt, input.migrations),
      ])
    }),
})
