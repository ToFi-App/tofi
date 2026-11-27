import { useCallback, useState } from 'react'
import { createPlaidLinkSession } from '@/lib/plaid/createLinkSession'
import { api } from '@/lib/api/client'
import { haptics } from '@/lib/ui/haptics'

interface OpenOptions {
  /** Runs after the session succeeds and queries are invalidated. */
  onCompleted?: () => void | Promise<void>
}

interface UpdateOptions extends OpenOptions {
  /** Lets the user change which accounts at this institution are shared. */
  accountSelection?: boolean
}

/**
 * The one place a Plaid Link session is opened.
 *
 * Plaid Link runs in two modes and the difference is expensive. A session opened WITHOUT an
 * existing access token creates a new Item on success, and Items are capped for all time on a
 * Plaid trial plan — /item/remove never refunds one. A session opened WITH an access token
 * (update mode) re-authenticates the Item that already exists and costs nothing.
 *
 * So the two are separate entry points with separate success handlers rather than one handler
 * behind a flag: openUpdateLink must never reach exchangeToken, because exchanging is precisely
 * what spends an Item. Keeping the paths apart makes that a structural guarantee instead of a
 * condition someone can get wrong later.
 */
export function useLinkSession() {
  const [isConnecting, setIsConnecting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const utils = api.useUtils()
  const createLinkToken = api.plaidLink.createLinkToken.useMutation()
  const createUpdateToken = api.plaidLink.createUpdateToken.useMutation()
  const exchangeToken = api.plaidLink.exchangeToken.useMutation()

  const refreshConnections = useCallback(async () => {
    await Promise.all([utils.accounts.list.invalidate(), utils.accounts.listInstitutions.invalidate()])
  }, [utils])

  /** Shared plumbing: fetch a link token, open Link, route the outcome. */
  const run = useCallback(
    async (
      getToken: () => Promise<{ linkToken: string }>,
      onSuccess: (publicToken: string) => Promise<void>,
      failureMessage: string,
    ) => {
      setError(null)
      setIsConnecting(true)
      try {
        const { linkToken } = await getToken()
        const session = await createPlaidLinkSession({
          token: linkToken,
          onEvent: () => {},
          onExit: (exit) => {
            setIsConnecting(false)
            if (exit.error) setError(exit.error.errorMessage ?? 'Bank connection was cancelled.')
          },
          onSuccess: async (success) => {
            try {
              await onSuccess(success.publicToken)
            } catch (err) {
              setError(err instanceof Error ? err.message : failureMessage)
            } finally {
              setIsConnecting(false)
            }
          },
        })
        await session.open()
      } catch (err) {
        setIsConnecting(false)
        setError(err instanceof Error ? err.message : 'Could not open Plaid Link. Try again.')
      }
    },
    [],
  )

  /** Connect an institution that has never been linked. This is the only path that spends an Item. */
  const openCreateLink = useCallback(
    (options: OpenOptions = {}) =>
      run(
        () => createLinkToken.mutateAsync(),
        async (publicToken) => {
          await exchangeToken.mutateAsync({ publicToken })
          await refreshConnections()
          haptics.success()
          await options.onCompleted?.()
        },
        'Could not finish linking this account.',
      ),
    [run, createLinkToken, exchangeToken, refreshConnections],
  )

  /**
   * Re-authenticate or reshape an existing connection. The public token Link hands back here is
   * deliberately ignored: the access token already stored server-side stays valid, and
   * exchanging would create the second Item this whole path exists to avoid.
   */
  const openUpdateLink = useCallback(
    (itemId: string, options: UpdateOptions = {}) =>
      run(
        () => createUpdateToken.mutateAsync({ itemId, accountSelection: options.accountSelection }),
        async () => {
          await refreshConnections()
          haptics.success()
          await options.onCompleted?.()
        },
        'Could not update this connection.',
      ),
    [run, createUpdateToken, refreshConnections],
  )

  return {
    openCreateLink,
    openUpdateLink,
    isConnecting,
    error,
    setError,
  }
}
