import { beforeEach, describe, expect, it, vi } from 'vitest'

const createClientMock = vi.fn(() => ({ __mocked: true }))
vi.mock('@supabase/supabase-js', () => ({ createClient: createClientMock }))

describe('getServiceClient', () => {
  beforeEach(() => {
    vi.resetModules()
    createClientMock.mockClear()
    process.env.SUPABASE_URL = 'https://example.supabase.co'
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-key'
  })

  it('creates a client bounded by a fetch timeout, so a stalled connection can\'t hang forever', async () => {
    const { getServiceClient } = await import('./serviceClient.js')

    getServiceClient()

    expect(createClientMock).toHaveBeenCalledWith(
      'https://example.supabase.co',
      'service-key',
      expect.objectContaining({ global: expect.objectContaining({ fetch: expect.any(Function) }) }),
    )
  })

  it('reuses the same client across calls, unlike the per-request scoped client', async () => {
    const { getServiceClient } = await import('./serviceClient.js')

    const a = getServiceClient()
    const b = getServiceClient()

    expect(a).toBe(b)
    expect(createClientMock).toHaveBeenCalledTimes(1)
  })
})
