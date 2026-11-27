import { beforeEach, describe, expect, it, vi } from 'vitest'

const repoMock = {
  list: vi.fn(),
  findById: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  setResolved: vi.fn(),
  delete: vi.fn(),
  addMembers: vi.fn(),
  removeMembers: vi.fn(),
}
vi.mock('../repositories/transactionGroupRepository.js', () => ({
  transactionGroupRepository: repoMock,
  isUniqueViolation: (error: unknown) => (error as { code?: string })?.code === '23505',
}))

const assertOwnedRefsMock = vi.fn()
vi.mock('../lib/ownership/assertOwnedRefs.js', () => ({ assertOwnedRefs: assertOwnedRefsMock }))

const GROUP_ID = '11111111-1111-4111-8111-111111111111'
const MANUAL_ID = '22222222-2222-4222-8222-222222222222'

describe('transactionGroups router', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    repoMock.findById.mockResolvedValue({ id: GROUP_ID })
    assertOwnedRefsMock.mockResolvedValue(undefined)
  })

  async function caller() {
    const { transactionGroupsRouter } = await import('./transactionGroups.js')
    return transactionGroupsRouter.createCaller({ userId: 'user-1', email: null, jwt: 'jwt-1' })
  }

  it('create trims the name and passes the scoped jwt and user id through', async () => {
    repoMock.create.mockResolvedValue({ id: GROUP_ID })

    await (await caller()).create({ name: '  Tahoe ski trip ', color: '#8B5CF6', icon: null })

    expect(repoMock.create).toHaveBeenCalledWith('jwt-1', 'user-1', { name: 'Tahoe ski trip', color: '#8B5CF6', icon: null })
  })

  it('create rejects a blank name and a non-hex colour', async () => {
    await expect((await caller()).create({ name: '   ', color: '#8B5CF6', icon: null })).rejects.toThrow()
    await expect((await caller()).create({ name: 'Trip', color: 'violet', icon: null })).rejects.toThrow()
    expect(repoMock.create).not.toHaveBeenCalled()
  })

  it('resolve and reopen set and clear the resolved flag', async () => {
    await (await caller()).resolve({ id: GROUP_ID })
    await (await caller()).reopen({ id: GROUP_ID })

    expect(repoMock.setResolved).toHaveBeenNthCalledWith(1, 'jwt-1', GROUP_ID, true)
    expect(repoMock.setResolved).toHaveBeenNthCalledWith(2, 'jwt-1', GROUP_ID, false)
  })

  it('addMembers checks the group and manual ids belong to the caller before inserting', async () => {
    repoMock.addMembers.mockResolvedValue([])
    const members = [
      { plaidTransactionId: 'plaid-1', manualTransactionId: null },
      { plaidTransactionId: null, manualTransactionId: MANUAL_ID },
    ]

    await (await caller()).addMembers({ groupId: GROUP_ID, members })

    expect(repoMock.findById).toHaveBeenCalledWith('jwt-1', GROUP_ID)
    expect(assertOwnedRefsMock).toHaveBeenCalledWith('jwt-1', { manualTransactionIds: [null, MANUAL_ID] })
    expect(repoMock.addMembers).toHaveBeenCalledWith('jwt-1', 'user-1', GROUP_ID, members)
  })

  // The member insert's FK check runs as the system and would accept another user's group id.
  it('addMembers refuses a group the caller cannot see', async () => {
    repoMock.findById.mockResolvedValue(null)

    await expect(
      (await caller()).addMembers({ groupId: GROUP_ID, members: [{ plaidTransactionId: 'plaid-1', manualTransactionId: null }] }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' })
    expect(repoMock.addMembers).not.toHaveBeenCalled()
  })

  it('addMembers rejects a member with both or neither id set', async () => {
    await expect(
      (await caller()).addMembers({ groupId: GROUP_ID, members: [{ plaidTransactionId: 'plaid-1', manualTransactionId: MANUAL_ID }] }),
    ).rejects.toThrow()
    await expect(
      (await caller()).addMembers({ groupId: GROUP_ID, members: [{ plaidTransactionId: null, manualTransactionId: null }] }),
    ).rejects.toThrow()
    expect(repoMock.addMembers).not.toHaveBeenCalled()
  })

  it('addMembers turns "already in a group" into a CONFLICT', async () => {
    repoMock.addMembers.mockRejectedValue({ code: '23505', message: 'duplicate key' })

    await expect(
      (await caller()).addMembers({ groupId: GROUP_ID, members: [{ plaidTransactionId: 'plaid-1', manualTransactionId: null }] }),
    ).rejects.toMatchObject({ code: 'CONFLICT' })
  })

  it('removeMembers is scoped to the group it names', async () => {
    const memberId = '33333333-3333-4333-8333-333333333333'

    await (await caller()).removeMembers({ groupId: GROUP_ID, memberIds: [memberId] })

    expect(repoMock.removeMembers).toHaveBeenCalledWith('jwt-1', GROUP_ID, [memberId])
  })
})
