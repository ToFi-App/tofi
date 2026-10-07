import { beforeEach, describe, expect, it, vi } from 'vitest'

const credRepoMock = { getDecrypted: vi.fn() }
const itemRepoMock = { listDecryptedTokens: vi.fn() }
const investmentRepoMock = { getHoldings: vi.fn(), getAccountActivity: vi.fn() }
vi.mock('../repositories/plaidCredentialRepository.js', () => ({ plaidCredentialRepository: credRepoMock }))
vi.mock('../repositories/plaidItemRepository.js', () => ({ plaidItemRepository: itemRepoMock }))
vi.mock('../repositories/investmentRepository.js', () => ({ investmentRepository: investmentRepoMock }))
vi.mock('../lib/plaid/client.js', () => ({ createPlaidClient: vi.fn(() => ({ tag: 'client' })) }))

describe('investments router', () => {
  beforeEach(() => vi.clearAllMocks())

  async function caller() {
    const { investmentsRouter } = await import('./investments.js')
    return investmentsRouter.createCaller({ userId: 'user-1', email: null, jwt: 'jwt-1' })
  }

  it('holdings resolves the item token and fetches for the given account', async () => {
    credRepoMock.getDecrypted.mockResolvedValue({ clientId: 'c', secret: 's', environment: 'sandbox' })
    itemRepoMock.listDecryptedTokens.mockResolvedValue([
      { itemId: 'item-1', accessToken: 'token-1', institutionName: 'Chase', institutionId: 'ins_1', institutionLogo: null },
    ])
    investmentRepoMock.getHoldings.mockResolvedValue([{ securityId: 's1' }])

    const result = await (await caller()).holdings({ itemId: 'item-1', accountId: 'acc-ira' })

    expect(investmentRepoMock.getHoldings).toHaveBeenCalledWith({ tag: 'client' }, 'token-1', 'acc-ira')
    expect(result).toEqual([{ securityId: 's1' }])
  })

  it('holdings rejects an itemId that does not belong to the user', async () => {
    credRepoMock.getDecrypted.mockResolvedValue({ clientId: 'c', secret: 's', environment: 'sandbox' })
    itemRepoMock.listDecryptedTokens.mockResolvedValue([])

    await expect((await caller()).holdings({ itemId: 'item-x', accountId: 'acc-1' })).rejects.toThrow(/not linked/i)
    expect(investmentRepoMock.getHoldings).not.toHaveBeenCalled()
  })

  it('holdings rejects when no Plaid credentials exist', async () => {
    credRepoMock.getDecrypted.mockResolvedValue(null)

    await expect((await caller()).holdings({ itemId: 'item-1', accountId: 'acc-1' })).rejects.toThrow(/credentials/i)
  })

  it('activity fetches one account\'s full activity with that item\'s token', async () => {
    credRepoMock.getDecrypted.mockResolvedValue({ clientId: 'c', secret: 's', environment: 'sandbox' })
    itemRepoMock.listDecryptedTokens.mockResolvedValue([
      { itemId: 'item-1', accessToken: 'token-1', institutionName: 'Chase', institutionId: 'ins_1', institutionLogo: null },
    ])
    investmentRepoMock.getAccountActivity.mockResolvedValue({ transactions: [], securities: [] })

    const result = await (await caller()).activity({
      itemId: 'item-1',
      accountId: 'acc-ira',
      startDate: '2023-10-06',
      endDate: '2025-10-06',
    })

    expect(investmentRepoMock.getAccountActivity).toHaveBeenCalledWith(
      { tag: 'client' },
      'token-1',
      'acc-ira',
      '2023-10-06',
      '2025-10-06',
    )
    expect(result).toEqual({ transactions: [], securities: [] })
  })

  it('activity rejects an itemId that does not belong to the user', async () => {
    credRepoMock.getDecrypted.mockResolvedValue({ clientId: 'c', secret: 's', environment: 'sandbox' })
    itemRepoMock.listDecryptedTokens.mockResolvedValue([])

    await expect(
      (await caller()).activity({ itemId: 'item-x', accountId: 'a', startDate: '2023-10-06', endDate: '2025-10-06' }),
    ).rejects.toThrow(/not linked/i)
    expect(investmentRepoMock.getAccountActivity).not.toHaveBeenCalled()
  })
})
