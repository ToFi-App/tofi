import { describe, expect, it } from 'vitest'
import { createPlaidClient } from './client.js'

describe('createPlaidClient', () => {
  it('bounds every call with a timeout, so a stalled connection to Plaid can\'t hang forever', () => {
    const client = createPlaidClient('client-id', 'secret', 'sandbox')
    // `configuration` is `protected` on PlaidApi's generated base class — reachable at runtime,
    // just not through the public type.
    const configuration = (client as unknown as { configuration: { baseOptions: Record<string, unknown> } })
      .configuration

    expect(configuration.baseOptions).toMatchObject({
      timeout: 15_000,
      headers: { 'PLAID-CLIENT-ID': 'client-id', 'PLAID-SECRET': 'secret' },
    })
  })
})
