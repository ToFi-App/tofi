import { beforeEach, describe, expect, it, vi } from 'vitest'

const credRepoMock = { getDecrypted: vi.fn() }
const itemRepoMock = {
  listDecryptedTokens: vi.fn(),
  getDecryptedToken: vi.fn(),
  setDisabled: vi.fn(),
  delete: vi.fn(),
}
vi.mock('../repositories/plaidCredentialRepository.js', () => ({ plaidCredentialRepository: credRepoMock }))
vi.mock('../repositories/plaidItemRepository.js', () => ({ plaidItemRepository: itemRepoMock }))

const accountsGet = vi.fn()
const itemRemove = vi.fn()
vi.mock('../lib/plaid/client.js', () => ({ createPlaidClient: vi.fn(() => ({ accountsGet, itemRemove })) }))

const ctx = { userId: 'user-1', email: 'user@example.com', jwt: 'jwt-1' }

describe('accounts router', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    credRepoMock.getDecrypted.mockResolvedValue({ clientId: 'c', secret: 's', environment: 'production' })
  })

  it('list relays live balances across every linked item, tagged with institution name', async () => {
    itemRepoMock.listDecryptedTokens.mockResolvedValue([
      { itemId: 'item-1', accessToken: 'access-1', institutionName: 'Chase' },
    ])
    accountsGet.mockResolvedValue({
      data: { accounts: [{ account_id: 'acc-1', name: 'Sapphire', balances: { current: 4821 } }] },
    })

    const { accountsRouter } = await import('./accounts.js')
    const caller = accountsRouter.createCaller(ctx)

    const result = await caller.list()

    expect(accountsGet).toHaveBeenCalledWith({ access_token: 'access-1' })
    expect(result).toEqual({
      accounts: [
        {
          account_id: 'acc-1',
          name: 'Sapphire',
          balances: { current: 4821 },
          institutionName: 'Chase',
          itemId: 'item-1',
          // Explicit rather than absent: the field is always present in the response, and this
          // institution has neither a Plaid logo nor a bundled one.
          institutionLogo: null,
        },
      ],
      itemErrors: [],
    })
  })

  it('returns the surviving accounts when one item fails, instead of throwing', async () => {
    itemRepoMock.listDecryptedTokens.mockResolvedValue([
      { itemId: 'item-broken', accessToken: 'access-broken', institutionName: 'Old Bank' },
      { itemId: 'item-ok', accessToken: 'access-ok', institutionName: 'Chase' },
    ])
    accountsGet
      // Shaped like a real Plaid rejection: axios puts the status string on the message and the
      // code the caller can act on in the response body.
      .mockRejectedValueOnce(
        Object.assign(new Error('Request failed with status code 400'), {
          response: {
            data: {
              error_type: 'ITEM_ERROR',
              error_code: 'ITEM_LOGIN_REQUIRED',
              error_message: 'the login details of this item have changed',
            },
          },
        }),
      )
      .mockResolvedValueOnce({ data: { accounts: [{ account_id: 'acc-1', name: 'Sapphire' }] } })

    const { accountsRouter } = await import('./accounts.js')
    const caller = accountsRouter.createCaller(ctx)

    const result = await caller.list()

    expect(result.accounts).toEqual([
      { account_id: 'acc-1', name: 'Sapphire', institutionName: 'Chase', itemId: 'item-ok', institutionLogo: null },
    ])
    expect(result.itemErrors).toEqual([
      {
        itemId: 'item-broken',
        institutionName: 'Old Bank',
        message: 'the login details of this item have changed',
        errorCode: 'ITEM_LOGIN_REQUIRED',
      },
    ])
  })

  it('reports every failing item rather than stopping at the first', async () => {
    itemRepoMock.listDecryptedTokens.mockResolvedValue([
      { itemId: 'item-a', accessToken: 'access-a', institutionName: 'Bank A' },
      { itemId: 'item-b', accessToken: 'access-b', institutionName: 'Bank B' },
    ])
    accountsGet.mockRejectedValue(new Error('nope'))

    const { accountsRouter } = await import('./accounts.js')
    const caller = accountsRouter.createCaller(ctx)

    const result = await caller.list()

    expect(result.accounts).toEqual([])
    expect(result.itemErrors.map((e) => e.itemId)).toEqual(['item-a', 'item-b'])
  })

  it('still throws when the user has no credentials at all', async () => {
    credRepoMock.getDecrypted.mockResolvedValue(null)

    const { accountsRouter } = await import('./accounts.js')
    const caller = accountsRouter.createCaller(ctx)

    await expect(caller.list()).rejects.toThrow()
  })

  describe('disconnecting an institution', () => {
    it('disconnect flags the item locally and leaves the Item alive at Plaid', async () => {
      const { accountsRouter } = await import('./accounts.js')
      const caller = accountsRouter.createCaller(ctx)

      await caller.disconnectInstitution({ itemId: 'item-1' })

      expect(itemRepoMock.setDisabled).toHaveBeenCalledWith('user-1', 'item-1', true)
      // The point of a soft disconnect: revoking would spend a Plaid Item allowance for good.
      expect(itemRemove).not.toHaveBeenCalled()
    })

    it('reconnect clears the flag, no Link session or new Item involved', async () => {
      const { accountsRouter } = await import('./accounts.js')
      const caller = accountsRouter.createCaller(ctx)

      await caller.reconnectInstitution({ itemId: 'item-1' })

      expect(itemRepoMock.setDisabled).toHaveBeenCalledWith('user-1', 'item-1', false)
    })

    it('remove revokes at Plaid and deletes the row', async () => {
      itemRepoMock.getDecryptedToken.mockResolvedValue({
        itemId: 'item-1',
        accessToken: 'access-1',
        institutionName: 'Chase',
        institutionId: 'ins_chase',
        disabled: false,
      })

      const { accountsRouter } = await import('./accounts.js')
      const caller = accountsRouter.createCaller(ctx)

      await caller.removeInstitution({ itemId: 'item-1' })

      expect(itemRemove).toHaveBeenCalledWith({ access_token: 'access-1' })
      expect(itemRepoMock.delete).toHaveBeenCalledWith('user-1', 'item-1')
    })

    it('remove still revokes an already-disconnected item, which the live list hides', async () => {
      itemRepoMock.getDecryptedToken.mockResolvedValue({
        itemId: 'item-1',
        accessToken: 'access-1',
        institutionName: 'Chase',
        institutionId: 'ins_chase',
        disabled: true,
      })

      const { accountsRouter } = await import('./accounts.js')
      const caller = accountsRouter.createCaller(ctx)

      await caller.removeInstitution({ itemId: 'item-1' })

      expect(itemRemove).toHaveBeenCalledWith({ access_token: 'access-1' })
      expect(itemRepoMock.delete).toHaveBeenCalledWith('user-1', 'item-1')
    })
  })
})
