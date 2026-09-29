import { describe, expect, it, vi } from 'vitest'

const createClientMock = vi.fn(() => ({ __mocked: true }))
vi.mock('@supabase/supabase-js', () => ({ createClient: createClientMock }))

describe('getScopedClient', () => {
  it('creates a new Supabase client authenticated with the caller JWT', async () => {
    process.env.SUPABASE_URL = 'https://example.supabase.co'
    process.env.SUPABASE_ANON_KEY = 'anon-key'
    const { getScopedClient } = await import('./scopedClient.js')

    getScopedClient('user-jwt-123')

    expect(createClientMock).toHaveBeenCalledWith(
      'https://example.supabase.co',
      'anon-key',
      expect.objectContaining({
        global: expect.objectContaining({
          headers: { Authorization: 'Bearer user-jwt-123' },
          fetch: expect.any(Function),
        }),
      }),
    )
  })

  it('creates a distinct client on every call (no shared singleton)', async () => {
    const { getScopedClient } = await import('./scopedClient.js')
    const a = getScopedClient('jwt-a')
    const b = getScopedClient('jwt-b')
    expect(a).not.toBe(b)
  })
})
