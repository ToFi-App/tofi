import { beforeEach, describe, expect, it, vi } from 'vitest'

const deletionRepoMock = { deleteAllUserData: vi.fn() }
vi.mock('../repositories/accountDeletionRepository.js', () => ({
  accountDeletionRepository: deletionRepoMock,
}))

const credentialRepoMock = { getDecrypted: vi.fn() }
vi.mock('../repositories/plaidCredentialRepository.js', () => ({
  plaidCredentialRepository: credentialRepoMock,
}))

const itemRepoMock = { listAllDecryptedTokens: vi.fn() }
vi.mock('../repositories/plaidItemRepository.js', () => ({ plaidItemRepository: itemRepoMock }))

const itemRemove = vi.fn()
vi.mock('../lib/plaid/client.js', () => ({ createPlaidClient: vi.fn(() => ({ itemRemove })) }))

const deleteUser = vi.fn()
vi.mock('../lib/supabase/serviceClient.js', () => ({
  getServiceClient: () => ({ auth: { admin: { deleteUser } } }),
}))

const CREDENTIALS = { clientId: 'client-1', secret: 'secret-1', environment: 'production' }

describe('accountDeletionService.deleteAccount', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    credentialRepoMock.getDecrypted.mockResolvedValue(CREDENTIALS)
    itemRepoMock.listAllDecryptedTokens.mockResolvedValue([
      { itemId: 'item-1', accessToken: 'access-1' },
      { itemId: 'item-2', accessToken: 'access-2' },
    ])
    itemRemove.mockResolvedValue({})
    deleteUser.mockResolvedValue({ error: null })
  })

  it('revokes every linked Plaid item', async () => {
    const { accountDeletionService } = await import('./accountDeletionService.js')

    await accountDeletionService.deleteAccount('user-1')

    expect(itemRemove).toHaveBeenCalledTimes(2)
    expect(itemRemove).toHaveBeenCalledWith({ access_token: 'access-1' })
    expect(itemRemove).toHaveBeenCalledWith({ access_token: 'access-2' })
  })

  it('deletes the user rows and then the auth user', async () => {
    const order: string[] = []
    deletionRepoMock.deleteAllUserData.mockImplementation(async () => void order.push('rows'))
    deleteUser.mockImplementation(async () => {
      order.push('auth')
      return { error: null }
    })
    const { accountDeletionService } = await import('./accountDeletionService.js')

    await expect(accountDeletionService.deleteAccount('user-1')).resolves.toEqual({ deleted: true })

    expect(deletionRepoMock.deleteAllUserData).toHaveBeenCalledWith('user-1')
    expect(deleteUser).toHaveBeenCalledWith('user-1')
    expect(order).toEqual(['rows', 'auth'])
  })

  // The tokens live in the rows the delete destroys, so revoking afterwards would have nothing
  // to revoke with.
  it('revokes at Plaid before destroying the rows holding the tokens', async () => {
    const order: string[] = []
    itemRemove.mockImplementation(async () => void order.push('revoke'))
    deletionRepoMock.deleteAllUserData.mockImplementation(async () => void order.push('rows'))
    const { accountDeletionService } = await import('./accountDeletionService.js')

    await accountDeletionService.deleteAccount('user-1')

    expect(order).toEqual(['revoke', 'revoke', 'rows'])
  })

  it('still deletes the account when Plaid refuses to revoke an item', async () => {
    itemRemove.mockRejectedValue(new Error('ITEM_NOT_FOUND'))
    const { accountDeletionService } = await import('./accountDeletionService.js')

    await expect(accountDeletionService.deleteAccount('user-1')).resolves.toEqual({ deleted: true })

    expect(deletionRepoMock.deleteAllUserData).toHaveBeenCalledWith('user-1')
    expect(deleteUser).toHaveBeenCalledWith('user-1')
  })

  it('deletes an account that never connected Plaid', async () => {
    credentialRepoMock.getDecrypted.mockResolvedValue(null)
    const { accountDeletionService } = await import('./accountDeletionService.js')

    await expect(accountDeletionService.deleteAccount('user-1')).resolves.toEqual({ deleted: true })

    expect(itemRepoMock.listAllDecryptedTokens).not.toHaveBeenCalled()
    expect(itemRemove).not.toHaveBeenCalled()
    expect(deleteUser).toHaveBeenCalledWith('user-1')
  })

  // A surfaced failure lets the user retry; swallowing it would report success over an account
  // that can still sign in.
  it('surfaces a failure to delete the auth user', async () => {
    deleteUser.mockResolvedValue({ error: { message: 'service role key rejected' } })
    const { accountDeletionService } = await import('./accountDeletionService.js')

    await expect(accountDeletionService.deleteAccount('user-1')).rejects.toThrow(
      'service role key rejected',
    )
  })

  // The auth-user delete is the one step that can't be retried or undone, so whether it failed
  // because Supabase's admin API is genuinely down matters — errorLogging.ts's networkErrorOf
  // can only tell that apart from a real rejection if the original error survives as the cause.
  it('keeps the original error as the cause, not just its message', async () => {
    const authRetryableFetchError = Object.assign(new Error('AbortError'), {
      name: 'AuthRetryableFetchError',
      status: 0,
    })
    deleteUser.mockResolvedValue({ error: authRetryableFetchError })
    const { accountDeletionService } = await import('./accountDeletionService.js')

    await expect(accountDeletionService.deleteAccount('user-1')).rejects.toMatchObject({
      cause: authRetryableFetchError,
    })
  })
})
