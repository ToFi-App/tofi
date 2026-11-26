import { TRPCError } from '@trpc/server'
import { z } from 'zod'
import { protectedProcedure, router } from '../trpc/trpc.js'
import { isUniqueViolation, transactionGroupRepository } from '../repositories/transactionGroupRepository.js'
import { assertOwnedRefs } from '../lib/ownership/assertOwnedRefs.js'

const nameSchema = z.string().trim().min(1).max(60)
const colorSchema = z.string().regex(/^#[0-9a-fA-F]{6}$/)
const iconSchema = z.string().min(1).max(64).nullable()

const memberRefSchema = z
  .object({
    plaidTransactionId: z.string().min(1).nullable(),
    manualTransactionId: z.string().uuid().nullable(),
  })
  .refine((ref) => (ref.plaidTransactionId !== null) !== (ref.manualTransactionId !== null), {
    message: 'A member references exactly one transaction',
  })

/**
 * The group id comes from the client, and the member insert's FK check runs as the system —
 * it would happily attach a row to another user's group. Resolving the group through the
 * caller's own RLS scope first closes that, the same way assertOwnedRefs does for manual ids.
 */
async function assertOwnedGroup(jwt: string, groupId: string): Promise<void> {
  const group = await transactionGroupRepository.findById(jwt, groupId)
  if (!group) throw new TRPCError({ code: 'NOT_FOUND', message: 'Group not found.' })
}

export const transactionGroupsRouter = router({
  list: protectedProcedure.query(({ ctx }) => transactionGroupRepository.list(ctx.jwt)),

  create: protectedProcedure
    .input(z.object({ name: nameSchema, color: colorSchema, icon: iconSchema }))
    .mutation(({ ctx, input }) => transactionGroupRepository.create(ctx.jwt, ctx.userId, input)),

  update: protectedProcedure
    .input(z.object({ id: z.string().uuid(), name: nameSchema.optional(), color: colorSchema.optional(), icon: iconSchema.optional() }))
    .mutation(({ ctx, input }) => {
      const { id, ...patch } = input
      return transactionGroupRepository.update(ctx.jwt, id, patch)
    }),

  delete: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(({ ctx, input }) => transactionGroupRepository.delete(ctx.jwt, input.id)),

  resolve: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(({ ctx, input }) => transactionGroupRepository.setResolved(ctx.jwt, input.id, true)),

  reopen: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(({ ctx, input }) => transactionGroupRepository.setResolved(ctx.jwt, input.id, false)),

  addMembers: protectedProcedure
    .input(z.object({ groupId: z.string().uuid(), members: z.array(memberRefSchema).min(1).max(200) }))
    .mutation(async ({ ctx, input }) => {
      await Promise.all([
        assertOwnedGroup(ctx.jwt, input.groupId),
        assertOwnedRefs(ctx.jwt, { manualTransactionIds: input.members.map((m) => m.manualTransactionId) }),
      ])
      try {
        return await transactionGroupRepository.addMembers(ctx.jwt, ctx.userId, input.groupId, input.members)
      } catch (error) {
        if (isUniqueViolation(error)) {
          throw new TRPCError({ code: 'CONFLICT', message: 'One of these transactions is already in a group.' })
        }
        throw error
      }
    }),

  removeMembers: protectedProcedure
    .input(z.object({ groupId: z.string().uuid(), memberIds: z.array(z.string().uuid()).min(1).max(200) }))
    .mutation(({ ctx, input }) => transactionGroupRepository.removeMembers(ctx.jwt, input.groupId, input.memberIds)),
})
