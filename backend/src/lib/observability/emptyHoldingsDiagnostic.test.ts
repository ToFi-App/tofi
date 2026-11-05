import { afterEach, describe, expect, it, vi } from 'vitest'
import type { PlaidApi } from 'plaid'

vi.mock('./axiom.js', () => ({ sendToAxiom: vi.fn(async () => {}) }))
const { sendToAxiom } = await import('./axiom.js')
const { reportEmptyHoldings } = await import('./emptyHoldingsDiagnostic.js')

function clientReturning(result: () => Promise<unknown>): PlaidApi {
  return { investmentsHoldingsGet: vi.fn(result) } as unknown as PlaidApi
}

const base = { accessToken: 'tok', userId: 'u1', itemId: 'item-1', accountId: 'roth' }

describe('reportEmptyHoldings', () => {
  afterEach(() => vi.clearAllMocks())
  vi.spyOn(console, 'warn').mockImplementation(() => {})

  it('records which account ids the unfiltered holdings belong to', async () => {
    const client = clientReturning(async () => ({
      data: {
        request_id: 'req-1',
        accounts: [
          { account_id: 'roth', type: 'investment', subtype: 'roth', balances: { current: 1000 } },
          { account_id: 'brokerage', type: 'investment', subtype: 'brokerage', balances: { current: 5 } },
        ],
        holdings: [{ account_id: 'brokerage' }, { account_id: 'roth-old' }, { account_id: 'roth-old' }],
        securities: [{}, {}],
        item: { products: ['transactions'], consented_products: ['investments'], billed_products: [] },
      },
    }))
    await reportEmptyHoldings({ client, ...base })

    const [event] = vi.mocked(sendToAxiom).mock.calls[0][0] as Array<Record<string, unknown>>
    expect(event).toMatchObject({
      diagnostic: 'empty-holdings',
      accountId: 'roth',
      unfilteredRequestId: 'req-1',
      totalHoldings: 3,
      holdingsByAccount: { brokerage: 1, 'roth-old': 2 },
      targetInAccounts: true,
      orphanAccountIds: ['roth-old'],
      consentedProducts: ['investments'],
    })
    // No balances leave the server.
    expect(JSON.stringify(event)).not.toContain('1000')
  })

  it('records a Plaid error on the unfiltered call instead of throwing', async () => {
    const client = clientReturning(async () => {
      throw { response: { data: { error_code: 'PRODUCT_NOT_READY', request_id: 'req-2' } } }
    })
    await expect(reportEmptyHoldings({ client, ...base })).resolves.toBeUndefined()
    const [event] = vi.mocked(sendToAxiom).mock.calls[0][0] as Array<Record<string, unknown>>
    expect(event).toMatchObject({ unfilteredError: 'PRODUCT_NOT_READY', unfilteredRequestId: 'req-2' })
  })
})
