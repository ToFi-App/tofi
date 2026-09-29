import { Configuration, PlaidApi, PlaidEnvironments } from 'plaid'

// axios (what PlaidApi calls through) has no default timeout of its own — without this, a
// stalled connection to Plaid hangs the invocation indefinitely, on the request path for the
// app's core feature (transaction sync). 15s comfortably covers an ordinary Plaid API round
// trip while still failing well short of an unconfigured serverless function's own timeout.
const PLAID_TIMEOUT_MS = 15_000

export function createPlaidClient(
  clientId: string,
  secret: string,
  environment: 'sandbox' | 'production',
): PlaidApi {
  const configuration = new Configuration({
    basePath: PlaidEnvironments[environment],
    baseOptions: {
      headers: {
        'PLAID-CLIENT-ID': clientId,
        'PLAID-SECRET': secret,
      },
      timeout: PLAID_TIMEOUT_MS,
    },
  })
  return new PlaidApi(configuration)
}
