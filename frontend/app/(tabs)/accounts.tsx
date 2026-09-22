import { useMemo, useState } from 'react'
import { router } from 'expo-router'
import { Linking, Pressable, ScrollView, Text, View } from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import { SafeAreaView } from 'react-native-safe-area-context'
import { colors } from '@/constants/theme'
import { useAccounts } from '@/hooks/useAccounts'
import { useAccountOrder } from '@/hooks/useAccountOrder'
import { useAmountsMasked } from '@/hooks/useAmountsMasked'
import { useTransactionFeed } from '@/hooks/useTransactionFeed'
import { usePullToRefresh } from '@/hooks/usePullToRefresh'
import { usePlaidCredentials } from '@/hooks/usePlaidCredentials'
import { useAddAccountFlow } from '@/hooks/useAddAccountFlow'
import { HeroCard } from '@/components/dashboard/HeroCard'
import { AccountRow } from '@/components/accounts/AccountRow'
import { ReorderableList } from '@/components/accounts/ReorderableList'
import { AddAccountSheet } from '@/components/accounts/AddAccountSheet'
import { AccountDetailSheet } from '@/components/accounts/AccountDetailSheet'
import { InvestmentDetailSheet } from '@/components/accounts/InvestmentDetailSheet'
import { NetWorthTrendSheet } from '@/components/accounts/NetWorthTrendSheet'
import { ErrorBanner } from '@/components/ui/ErrorBanner'
import { EmptyState } from '@/components/ui/EmptyState'
import { formatMaskableAmount } from '@/lib/format/money'
import { computeNetWorthTotals, isInvestmentAccount, isLiabilityAccount } from '@/lib/accounts/netWorth'
import type { Account } from '@/types/domain'

export default function AccountsTab() {
  const [cashOpen, setCashOpen] = useState(true)
  const [investOpen, setInvestOpen] = useState(true)
  const [creditOpen, setCreditOpen] = useState(true)
  // 'cash' is the built-in cash row, which has no Plaid account behind it.
  const [detailTarget, setDetailTarget] = useState<Account | 'cash' | null>(null)
  const [investmentDetail, setInvestmentDetail] = useState<Account | null>(null)
  const [trendOpen, setTrendOpen] = useState(false)
  const accounts = useAccounts()
  const accountOrder = useAccountOrder()
  // A lifted row and a scrolling page are the same downward drag, so the page stops while
  // a row is in the air.
  const [isDragging, setIsDragging] = useState(false)
  const { isMasked, toggleMask } = useAmountsMasked()
  const { feed, categoryById, isLoading: feedIsLoading, refresh } = useTransactionFeed()
  // Also refetches accounts.list inside, which is where every balance on this screen lives.
  const refreshControl = usePullToRefresh(refresh)
  const credentials = usePlaidCredentials()
  const addAccount = useAddAccountFlow()
  const { error, setError, isConnecting } = addAccount

  // Investments are assets but not spendable cash — buys/sells/dividends inside them are
  // neither household expenses nor income, so they get their own section and a holdings
  // view instead of a transaction list.
  const cashAccounts = useMemo(
    () => (accounts.data ?? []).filter((a) => !isLiabilityAccount(a) && !isInvestmentAccount(a)),
    [accounts.data],
  )
  const investmentAccounts = useMemo(() => (accounts.data ?? []).filter(isInvestmentAccount), [accounts.data])
  const investmentsValue = useMemo(
    () => investmentAccounts.reduce((sum, a) => sum + (a.balances?.current ?? 0), 0),
    [investmentAccounts],
  )
  const creditAccounts = useMemo(() => (accounts.data ?? []).filter(isLiabilityAccount), [accounts.data])

  // totalAssets includes cash on hand, which is exactly what the Cash Accounts section totals
  // now that the Cash row lives inside it.
  const { totalAssets, totalLiabilities, cashOnHand, netWorth } = useMemo(
    () => computeNetWorthTotals(accounts.data ?? [], feed),
    [accounts.data, feed],
  )

  // Sliced off the same feed the other sheets read, rather than from the MMKV cache this sheet
  // used to read directly: only a resolved FeedItem carries transferKind and links, which is what
  // lets a matched transfer grey out and name its counterpart.
  const investmentDetailItems = useMemo(
    () => (investmentDetail ? feed.filter((item) => item.accountId === investmentDetail.account_id) : []),
    [investmentDetail, feed],
  )

  const detail = useMemo(() => {
    if (detailTarget == null) return null
    if (detailTarget === 'cash') {
      return {
        title: 'Cash',
        balance: cashOnHand,
        variant: 'cashOnHand' as const,
        // The built-in cash row has no institution behind it, so no item either — and so no logo.
        itemId: null,
        logo: null,
        items: feed.filter((item) => item.source === 'manual'),
        emptyLabel: 'No cash transactions yet',
      }
    }
    return {
      title: detailTarget.name,
      balance: detailTarget.balances?.current ?? 0,
      itemId: detailTarget.itemId,
      logo: detailTarget.institutionLogo,
      variant: isLiabilityAccount(detailTarget) ? ('credit' as const) : isInvestmentAccount(detailTarget) ? ('investment' as const) : ('cash' as const),
      items: feed.filter((item) => item.accountId === detailTarget.account_id),
      emptyLabel: 'No transactions for this account',
    }
  }, [detailTarget, feed, cashOnHand])

  // itemErrors suppresses the empty state: with every item failing there are no accounts to
  // show, but "link your first account" would be a lie — the accounts exist and are broken.
  // Falling through renders the per-institution warnings that say so.
  if (
    !accounts.isLoading &&
    (accounts.data?.length ?? 0) === 0 &&
    accounts.itemErrors.length === 0 &&
    !credentials.isLoading
  ) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }} edges={['top']}>
        <View className="px-5 pt-4">{error ? <ErrorBanner message={error} onDismiss={() => setError(null)} /> : null}</View>
        {!credentials.data ? (
          <EmptyState
            message="Connect your Plaid developer account to get started"
            actionLabel="Connect Plaid"
            onAction={() => router.push('/(tabs)/settings/plaid-account')}
          />
        ) : (
          <EmptyState
            message="Link your first account to get started"
            actionLabel="Link Account"
            onAction={addAccount.connectFirstAccount}
          />
        )}
      </SafeAreaView>
    )
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }} edges={['top']}>
      <ScrollView
        contentContainerClassName="gap-5 px-5 py-4"
        refreshControl={refreshControl}
        scrollEnabled={!isDragging}
      >
        <View className="flex-row items-center justify-between">
          <Text className="font-sansSemi text-lg text-primary">All</Text>
          <Pressable onPress={addAccount.beginAddAccount} accessibilityLabel="Add account" disabled={isConnecting}>
            <Ionicons name="add-circle-outline" size={26} color={colors.textPrimary} />
          </Pressable>
        </View>

        {error ? <ErrorBanner message={error} onDismiss={() => setError(null)} /> : null}

        {/* A failed reorder has already been rolled back to the server's order in the cache,
            so this explains a move the user watched snap back rather than announcing a
            failure they can't see. */}
        {accountOrder.error ? (
          <ErrorBanner message="Couldn't save the new account order." onDismiss={accountOrder.resetError} />
        ) : null}

        {/* Per-institution failures. The rest of the screen is live, so these are shown inline
            rather than as an error state — before, any one of them took the whole screen down. */}
        {accounts.itemErrors.map((itemError) => (
          <View key={itemError.itemId} className="flex-row items-start gap-2 rounded-xl bg-surface p-4">
            <Ionicons name="warning-outline" size={16} color={colors.expense} />
            <View className="flex-1 gap-1">
              <Text className="font-sansMed text-sm text-textPrimary">
                Couldn&apos;t load {itemError.institutionName}
              </Text>
              <Text className="font-sans text-xs leading-4 text-textMuted">
                Its balances and transactions are out of date.
              </Text>
              {/* Branched on kind: "Reconnect" means Plaid Link update mode, which has no meaning
                  for Apple accounts — FinanceKit access can only be restored in iOS Settings, and
                  the app cannot request it again once denied. */}
              {itemError.kind === 'financekit' ? (
                <Pressable
                  onPress={() => void Linking.openSettings()}
                  hitSlop={8}
                  accessibilityRole="button"
                  accessibilityLabel="Open Settings to restore access to your Apple accounts"
                  className="pt-1"
                >
                  <Text className="font-sansMed text-xs text-primary">Open Settings</Text>
                </Pressable>
              ) : (
                <Pressable
                  onPress={() => addAccount.repairConnection(itemError.itemId)}
                  disabled={isConnecting}
                  hitSlop={8}
                  accessibilityRole="button"
                  accessibilityLabel={`Reconnect ${itemError.institutionName}`}
                  className="pt-1"
                >
                  <Text className="font-sansMed text-xs text-primary">Reconnect</Text>
                </Pressable>
              )}
            </View>
          </View>
        ))}

        <HeroCard
          netWorth={netWorth}
          totalAssets={totalAssets}
          totalLiabilities={totalLiabilities}
          isLoading={accounts.isLoading}
          isMasked={isMasked}
          onToggleMask={toggleMask}
          onTrendPress={() => setTrendOpen(true)}
        />

        {/* Always rendered: the Cash row is a built-in account, present even with nothing linked. */}
        <View className="rounded-xl bg-surface px-4">
            <Pressable onPress={() => setCashOpen((v) => !v)} className="flex-row items-center justify-between gap-3 py-4">
              <Text className="font-sansSemi text-sm text-primary">Cash Accounts</Text>
              <View className="flex-row items-center gap-1">
                <Text className="font-sansMed text-sm text-textSecondary" numberOfLines={1}>Balance {formatMaskableAmount(totalAssets - investmentsValue, isMasked)}</Text>
                <Ionicons name={cashOpen ? 'chevron-up' : 'chevron-down'} size={14} color={colors.textMuted} />
              </View>
            </Pressable>
            {cashOpen ? (
              <View>
                <ReorderableList
                  items={cashAccounts}
                  keyExtractor={(account) => account.account_id}
                  onDragStateChange={setIsDragging}
                  onReorder={(next) => accountOrder.setOrder(next.map((a) => a.account_id))}
                  renderItem={(account, { handlers }) => (
                    <View className="border-t" style={{ borderColor: colors.border }}>
                      <AccountRow
                        name={account.name}
                        balance={account.balances?.current ?? 0}
                        variant="cash"
                        logo={account.institutionLogo}
                        itemId={account.itemId}
                        isMasked={isMasked}
                        onPress={() => setDetailTarget(account)}
                        {...handlers}
                      />
                    </View>
                  )}
                />
                <View className="border-t" style={{ borderColor: colors.border }}>
                  <AccountRow
                    name="Cash"
                    balance={cashOnHand}
                    variant="cashOnHand"
                    isMasked={isMasked}
                    onPress={() => setDetailTarget('cash')}
                  />
                </View>
              </View>
            ) : null}
        </View>

        {investmentAccounts.length > 0 ? (
          <View className="rounded-xl bg-surface px-4">
            <Pressable onPress={() => setInvestOpen((v) => !v)} className="flex-row items-center justify-between gap-3 py-4">
              <Text className="font-sansSemi text-sm text-primary">Investments</Text>
              <View className="flex-row items-center gap-1">
                <Text className="font-sansMed text-sm text-textSecondary" numberOfLines={1}>Value {formatMaskableAmount(investmentsValue, isMasked)}</Text>
                <Ionicons name={investOpen ? 'chevron-up' : 'chevron-down'} size={14} color={colors.textMuted} />
              </View>
            </Pressable>
            {investOpen ? (
              <View>
                <ReorderableList
                  items={investmentAccounts}
                  keyExtractor={(account) => account.account_id}
                  onDragStateChange={setIsDragging}
                  onReorder={(next) => accountOrder.setOrder(next.map((a) => a.account_id))}
                  renderItem={(account, { handlers }) => (
                    <View className="border-t" style={{ borderColor: colors.border }}>
                      <AccountRow
                        name={account.name}
                        balance={account.balances?.current ?? 0}
                        variant="investment"
                        logo={account.institutionLogo}
                        itemId={account.itemId}
                        isMasked={isMasked}
                        onPress={() => setInvestmentDetail(account)}
                        {...handlers}
                      />
                    </View>
                  )}
                />
              </View>
            ) : null}
          </View>
        ) : null}

        {creditAccounts.length > 0 ? (
          <View className="rounded-xl bg-surface px-4">
            <Pressable onPress={() => setCreditOpen((v) => !v)} className="flex-row items-center justify-between gap-3 py-4">
              <Text className="font-sansSemi text-sm text-expense">Credit Accounts</Text>
              <View className="flex-row items-center gap-1">
                <Text className="font-sansMed text-sm text-expense" numberOfLines={1}>Owed {formatMaskableAmount(totalLiabilities, isMasked)}</Text>
                <Ionicons name={creditOpen ? 'chevron-up' : 'chevron-down'} size={14} color={colors.textMuted} />
              </View>
            </Pressable>
            {creditOpen ? (
              <View>
                <ReorderableList
                  items={creditAccounts}
                  keyExtractor={(account) => account.account_id}
                  onDragStateChange={setIsDragging}
                  onReorder={(next) => accountOrder.setOrder(next.map((a) => a.account_id))}
                  renderItem={(account, { handlers }) => (
                    <View className="border-t" style={{ borderColor: colors.border }}>
                      <AccountRow
                        name={account.name}
                        balance={account.balances?.current ?? 0}
                        variant="credit"
                        logo={account.institutionLogo}
                        itemId={account.itemId}
                        limit={account.balances?.limit ?? null}
                        isMasked={isMasked}
                        onPress={() => setDetailTarget(account)}
                        {...handlers}
                      />
                    </View>
                  )}
                />
              </View>
            ) : null}
          </View>
        ) : null}
      </ScrollView>

      <AddAccountSheet
        visible={addAccount.pickerOpen}
        onClose={addAccount.closePicker}
        institutions={addAccount.connectedInstitutions}
        logoByItemId={addAccount.logoByItemId}
        onManageInstitution={addAccount.manageInstitution}
        appleAccounts={{
          // Hidden entirely when the device cannot serve FinanceKit data, and once the accounts are
          // already connected there is nothing left for this row to do.
          visible: accounts.financeKitStatus !== null && accounts.financeKitStatus !== 'unavailable',
          isConnected: accounts.financeKitStatus === 'authorized',
          onConnect: async () => {
            addAccount.closePicker()
            const outcome = await accounts.syncFinanceKit({ requestIfNeeded: true })
            // Denied is terminal for this session: iOS will not re-prompt, so the only remedy is
            // Settings. The item-error row above carries that affordance once status is denied.
            if (outcome.status === 'denied') void Linking.openSettings()
          },
        }}
        onConnectNewBank={addAccount.connectNewBank}
      />

      <NetWorthTrendSheet
        visible={trendOpen}
        onClose={() => setTrendOpen(false)}
        netWorth={netWorth}
        accounts={accounts.data ?? []}
        feed={feed}
        isLoading={accounts.isLoading || feedIsLoading}
      />

      <InvestmentDetailSheet
        account={investmentDetail}
        items={investmentDetailItems}
        feed={feed}
        categoryById={categoryById}
        isMasked={isMasked}
        onClose={() => setInvestmentDetail(null)}
      />

      <AccountDetailSheet
        visible={detail != null}
        title={detail?.title ?? ''}
        balance={detail?.balance ?? 0}
        variant={detail?.variant ?? 'cash'}
        itemId={detail?.itemId ?? null}
        logo={detail?.logo ?? null}
        items={detail?.items ?? []}
        feed={feed}
        emptyLabel={detail?.emptyLabel}
        isMasked={isMasked}
        categoryById={categoryById}
        onClose={() => setDetailTarget(null)}
      />
    </SafeAreaView>
  )
}
