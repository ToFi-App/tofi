import { beforeEach, describe, expect, it, vi } from 'vitest'
import { TRPCError } from '@trpc/server'

const alpacaMock = { getDailyCloses: vi.fn(), getSplits: vi.fn(), getLatestPrices: vi.fn() }
vi.mock('../lib/alpaca/client.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../lib/alpaca/client.js')>()),
  alpacaClientFromEnv: vi.fn(() => alpacaMock),
}))

describe('investments.priceHistory', () => {
  beforeEach(() => vi.clearAllMocks())

  async function caller() {
    const { investmentsRouter } = await import('./investments.js')
    return investmentsRouter.createCaller({ userId: 'user-1', email: null, jwt: 'jwt-1' })
  }

  it('relays raw closes and splits for the requested symbols and range', async () => {
    alpacaMock.getDailyCloses.mockResolvedValue({ AAPL: [{ date: '2025-01-02', close: 243.85 }] })
    alpacaMock.getSplits.mockResolvedValue([{ symbol: 'AAPL', exDate: '2020-08-31', oldRate: 1, newRate: 4 }])

    const result = await (await caller()).priceHistory({ symbols: ['AAPL'], startDate: '2025-01-01', endDate: '2025-01-31' })

    expect(alpacaMock.getDailyCloses).toHaveBeenCalledWith(['AAPL'], '2025-01-01', '2025-01-31')
    expect(result).toEqual({
      closes: { AAPL: [{ date: '2025-01-02', close: 243.85 }] },
      splits: [{ symbol: 'AAPL', exDate: '2020-08-31', oldRate: 1, newRate: 4 }],
    })
  })

  it('asks for splits through today, not just the requested range', async () => {
    // Today's share count from Plaid is post every split up to now, so a close from a month the
    // client already has cached still needs adjusting for a split that landed after it.
    alpacaMock.getDailyCloses.mockResolvedValue({ AAPL: [] })
    alpacaMock.getSplits.mockResolvedValue([])

    await (await caller()).priceHistory({
      symbols: ['AAPL'],
      startDate: '2025-06-01',
      endDate: '2025-06-30',
      splitsSince: '2024-06-01',
    })

    const [, start, end] = alpacaMock.getSplits.mock.calls[0]
    expect(start).toBe('2024-06-01')
    expect(end).toBe(new Date().toISOString().slice(0, 10))
  })

  it('turns an exhausted Alpaca quota into TOO_MANY_REQUESTS that keeps the wait', async () => {
    const { AlpacaRateLimitError } = await import('../lib/alpaca/client.js')
    alpacaMock.getDailyCloses.mockRejectedValue(new AlpacaRateLimitError(17))
    alpacaMock.getSplits.mockResolvedValue([])

    const error = await (await caller())
      .priceHistory({ symbols: ['AAPL'], startDate: '2025-01-01', endDate: '2025-01-31' })
      .catch((e) => e)

    expect(error).toBeInstanceOf(TRPCError)
    expect(error.code).toBe('TOO_MANY_REQUESTS')
    expect(error.cause).toBeInstanceOf(AlpacaRateLimitError)
    expect(error.cause.retryAfterSeconds).toBe(17)
  })

  it('rejects symbols Alpaca would 400 the whole batch over', async () => {
    await expect(
      (await caller()).priceHistory({ symbols: ['CUR:USD'], startDate: '2025-01-01', endDate: '2025-01-31' }),
    ).rejects.toThrow()
    expect(alpacaMock.getDailyCloses).not.toHaveBeenCalled()
  })
})

describe('investments.latestPrices', () => {
  beforeEach(() => vi.clearAllMocks())

  async function caller() {
    const { investmentsRouter } = await import('./investments.js')
    return investmentsRouter.createCaller({ userId: 'user-1', email: null, jwt: 'jwt-1' })
  }

  it('relays the latest trade per symbol', async () => {
    alpacaMock.getLatestPrices.mockResolvedValue({ AAA: { price: 101.5, at: '2025-01-06T20:59:58Z' } })

    const result = await (await caller()).latestPrices({ symbols: ['AAA'] })

    expect(alpacaMock.getLatestPrices).toHaveBeenCalledWith(['AAA'])
    expect(result).toEqual({ AAA: { price: 101.5, at: '2025-01-06T20:59:58Z' } })
  })

  it('keeps the wait on an exhausted quota', async () => {
    const { AlpacaRateLimitError } = await import('../lib/alpaca/client.js')
    alpacaMock.getLatestPrices.mockRejectedValue(new AlpacaRateLimitError(9))

    const error = await (await caller()).latestPrices({ symbols: ['AAA'] }).catch((e) => e)

    expect(error.code).toBe('TOO_MANY_REQUESTS')
    expect(error.cause.retryAfterSeconds).toBe(9)
  })
})
