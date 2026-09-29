import type { CreateFastifyContextOptions } from '@trpc/server/adapters/fastify'
import { verifyJwt } from '../middleware/requireAuth.js'

// authError is optional, not required: dozens of router tests build a Context literal by hand
// (`{ userId: 'user-1', email: null, jwt: 'jwt-1' }`) with no reason to care about it, and
// `protectedProcedure`'s `ctx.authError ?? undefined` already treats "absent" the same as "null".
export interface Context {
  userId: string | null
  email: string | null
  jwt: string | null
  authError?: unknown
}

export async function createContext({ req }: CreateFastifyContextOptions): Promise<Context> {
  const header = req.headers.authorization
  const token = header?.startsWith('Bearer ') ? header.slice(7) : null

  if (!token) {
    return { userId: null, email: null, jwt: null, authError: null }
  }

  try {
    const { userId, email } = await verifyJwt(token)
    return { userId, email, jwt: token, authError: null }
  } catch (authError) {
    // Kept, not discarded: a token that fails to verify because the JWKS fetch it depends on
    // timed out (Supabase's own auth infra being slow/unreachable) looks identical to an
    // ordinary expired/invalid token unless something downstream can tell them apart. See
    // trpc.ts's protectedProcedure, which attaches this as the UNAUTHORIZED error's cause.
    return { userId: null, email: null, jwt: null, authError }
  }
}
