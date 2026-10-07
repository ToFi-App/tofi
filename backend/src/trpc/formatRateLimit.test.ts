import { describe, expect, it } from 'vitest'
import { TRPCError } from '@trpc/server'
import { z } from 'zod'
import { router, protectedProcedure } from './trpc.js'
import { AlpacaRateLimitError } from '../lib/alpaca/client.js'

describe('error formatter', () => {
  it('exposes retryAfterSeconds on a rate-limited error so the client can wait it out', async () => {
    const testRouter = router({
      limited: protectedProcedure.input(z.void()).query(() => {
        throw new TRPCError({ code: 'TOO_MANY_REQUESTS', message: 'slow down', cause: new AlpacaRateLimitError(23) })
      }),
    })
    const { getErrorShape } = await import('@trpc/server/shared')
    const error = await testRouter
      .createCaller({ userId: 'u', email: null, jwt: 'j' })
      .limited()
      .catch((e) => e)

    const shape = getErrorShape({
      config: testRouter._def._config,
      error,
      type: 'query',
      path: 'limited',
      input: undefined,
      ctx: undefined,
    })

    expect(shape.data).toMatchObject({ code: 'TOO_MANY_REQUESTS', retryAfterSeconds: 23 })
  })
})
