import { useEffect, useMemo, useState } from 'react'
import { ActivityIndicator, Modal, Pressable, ScrollView, Text, View } from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import { BottomSheet, useSheetScroll } from '@/components/ui/BottomSheet'
import { HoldingsHeatMap } from '@/components/accounts/HoldingsHeatMap'
import { HoldingRows } from '@/components/accounts/HoldingRows'
import { TEAL_SHEET_BACKDROP } from '@/components/ui/TealSheetBackdrop'
import { DayGroupHeader } from '@/components/transactions/DayGroupHeader'
import { TransactionRow } from '@/components/transactions/TransactionRow'
import {
  TransactionEditorErrorBanner,
  useTransactionEditorActions,
} from '@/components/transactions/TransactionEditorProvider'
import { colors } from '@/constants/theme'
import { useHoldings } from '@/hooks/useHoldings'
import { formatGainPct, holdingsPricedAsOf, performanceColor } from '@/lib/accounts/holdings'
import { formatRelativeIsoTime } from '@/lib/format/date'
import { formatMaskableAmount } from '@/lib/format/money'
import { investmentHeadlineGain, netPrincipal } from '@/lib/accounts/principal'
import { groupByDay } from '@/lib/transactions/groupByDay'
import type { FeedItem } from '@/lib/transactions/resolveFeed'
import type { Account, Category } from '@/types/domain'

interface InvestmentDetailSheetProps {
  account: Account | null
  /** This account's slice of the feed. Investment-source rows only reach here as cash transfers. */
  items: FeedItem[]
  /** The whole feed. Editing needs context the slice doesn't carry — reimbursement candidates can
   *  sit on any account, and the delete warning has to know about reimbursement membership. */
  feed: FeedItem[]
  categoryById: Map<string, Category>
  isMasked: boolean
  onClose: () => void
}

/** How often the "last refreshed" label re-reads the clock while the sheet is open. */
const FRESHNESS_TICK_MS = 30 * 1000

// 24 months of transfers is a long list, and this one sits inside a ScrollView rather than a
// SectionList, so every row mounts eagerly whether or not it's scrolled to. Capped by DAY rather
// than by row so a day is never shown half-populated with a total that disagrees with the rows
// beneath it. Days arrive newest-first, so this keeps the recent ones the sheet is actually for.
const TRANSFER_DAY_LIMIT = 12

// Investment accounts get holdings ("what do I own") plus the cash that crossed the account's
// boundary ("what did I put in and take out"). Deliberately NOT the account's full activity:
// trades, fees and dividends are filtered out in the backend repository and never reach the
// client, because a buy is not household spending and one rebalance would swamp a month of it.
// The transfers shown here are exactly the rows autoMatch pairs against a linked checking
// account — which is the whole reason the investments product is read at all.
export function InvestmentDetailSheet({
  account,
  items,
  feed,
  categoryById,
  isMasked,
  onClose,
}: InvestmentDetailSheetProps) {
  const sheetScroll = useSheetScroll()
  const [showRefreshInfo, setShowRefreshInfo] = useState(false)
  // The label is relative ("5 min ago"), so it goes stale on its own while the sheet sits
  // open. Ticking only while it's open keeps a closed sheet from holding a timer.
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (account == null) return
    setNow(Date.now())
    const timer = setInterval(() => setNow(Date.now()), FRESHNESS_TICK_MS)
    return () => clearInterval(timer)
  }, [account])
  const holdings = useHoldings(account ? { itemId: account.itemId, accountId: account.account_id } : null)
  const needsRelink = holdings.error?.message.includes('ADDITIONAL_CONSENT_REQUIRED') ?? false

  // One highlighted holding, set from a tile or a row and shown in both.
  const [selectedId, setSelectedId] = useState<string | null>(null)
  useEffect(() => {
    setSelectedId(null)
  }, [account])
  // Dated by when the INSTITUTION priced these holdings, not by when we fetched them. Our
  // fetch time would read "just now" over a portfolio the brokerage last repriced two days
  // ago, which is the opposite of what a freshness label is for.
  const asOfLabel = formatRelativeIsoTime(holdingsPricedAsOf(holdings.data ?? []), now)

  // Capped by day, not by row: a partially-shown day would print an IN/OUT total covering rows
  // the user can't see.
  const days = useMemo(() => groupByDay(items), [items])
  const principal = useMemo(() => netPrincipal(items), [items])
  // The headline's second line: total return, or unrealized gain once withdrawals exceed deposits
  // (see investmentHeadlineGain). Total return overstates on an account older than the feed's
  // window — accepted; see totalReturn.
  const gain = useMemo(
    () => investmentHeadlineGain(account?.balances?.current ?? 0, principal, holdings.data ?? []),
    [account, principal, holdings.data],
  )
  const shownDays = days.slice(0, TRANSFER_DAY_LIMIT)
  const hiddenCount = days.slice(TRANSFER_DAY_LIMIT).reduce((sum, day) => sum + day.items.length, 0)

  return (
    <BottomSheet
      visible={account != null}
      onClose={onClose}
      contentScroll={sheetScroll}
      background={TEAL_SHEET_BACKDROP}
      // The default pill is near-white and disappears into the tinted top edge.
      grabberColor={colors.textMuted}
    >
      <View className="flex-row items-center justify-between px-5 py-3">
        <Pressable onPress={onClose} hitSlop={8}>
          <Ionicons name="close" size={22} color={colors.textSecondary} />
        </Pressable>
        <Text className="mx-3 flex-1 text-center font-display text-md text-textPrimary" numberOfLines={1}>
          {account?.name ?? ''}
        </Text>
        <View style={{ width: 22 }} />
      </View>

      {/* Left-aligned headline, like the Net Worth sheet: value, then the account's gain. */}
      <View className="items-start px-5 pb-2 pt-1">
        <Text className="font-display text-2xl text-textPrimary">
          {formatMaskableAmount(account?.balances?.current ?? 0, isMasked)}
        </Text>
        {gain ? (
          <View className="mt-1 flex-row items-center gap-1.5">
            {gain.gain !== 0 ? (
              <Ionicons
                name={gain.gain > 0 ? 'caret-up' : 'caret-down'}
                size={14}
                color={performanceColor(gain.pct).base}
              />
            ) : null}
            <Text className="font-sansSemi text-base" style={{ color: performanceColor(gain.pct).base }}>
              {formatMaskableAmount(Math.abs(gain.gain), isMasked)}
              {gain.pct != null ? ` (${formatGainPct(gain.pct)})` : ''}
            </Text>
          </View>
        ) : null}
        {/* Hidden entirely when no holding carries a price date: a confident-looking "as of"
            over an unknown pricing time is the one genuinely misleading thing this label
            could say. */}
        {asOfLabel ? (
          <Pressable
            onPress={() => setShowRefreshInfo((shown) => !shown)}
            hitSlop={8}
            className="mt-1 flex-row items-center gap-1"
          >
            <Text className="font-sansMed text-sm text-textSecondary">Updated {asOfLabel}</Text>
            <Ionicons name="information-circle-outline" size={15} color={colors.textSecondary} />
          </Pressable>
        ) : null}
        {/* A Modal rather than inline text so the explanation reads as a tooltip and never
            reflows the sheet under the user's finger. Nested inside the sheet's own Modal,
            which RN allows; the backdrop dismisses it so there is no button to miss. */}
        <Modal
          visible={showRefreshInfo}
          transparent
          animationType="fade"
          onRequestClose={() => setShowRefreshInfo(false)}
        >
          <Pressable
            className="flex-1 items-center justify-center px-10"
            style={{ backgroundColor: 'rgba(0,0,0,0.45)' }}
            onPress={() => setShowRefreshInfo(false)}
          >
            <View className="w-full rounded-2xl p-5" style={{ backgroundColor: colors.surface }}>
              <Text className="font-sansSemi text-sm text-textPrimary">How often values update</Text>
              <Text className="mt-2 font-sans text-xs leading-5 text-textMuted">
                Plaid collects new values from your brokerage at least once every market day,
                usually after close. Markets are shut on weekends and holidays, so a value can be a
                few days old even right after a refresh.
              </Text>
            </View>
          </Pressable>
        </Modal>
      </View>

      <View className="px-5">
        <TransactionEditorErrorBanner />
      </View>

      <ScrollView {...sheetScroll.scrollProps} className="px-5" contentContainerClassName="pb-10 pt-3">
        {holdings.isLoading ? (
          <View className="items-center py-8">
            <ActivityIndicator color={colors.primary} />
          </View>
        ) : holdings.error ? (
          <Text className="py-8 text-center font-sans text-sm text-textMuted">
            {needsRelink
              ? 'This institution needs to be reconnected to share holdings. Remove and relink it from Settings → Institutions.'
              : "Couldn't load holdings for this account."}
          </Text>
        ) : (holdings.data?.length ?? 0) === 0 ? (
          // Covers the "nothing at all" case too: when activity is also empty this is the
          // sheet's only message, and it still reads correctly — there ARE no holdings.
          <Text className="py-8 text-center font-sans text-sm text-textMuted">No holdings in this account</Text>
        ) : (
          <>
            <HoldingsHeatMap holdings={holdings.data!} selectedId={selectedId} onSelect={setSelectedId} />
            <HoldingRows holdings={holdings.data!} isMasked={isMasked} selectedId={selectedId} onSelect={setSelectedId} />
          </>
        )}

        {/* Sibling of the holdings conditional above, not nested inside its success branch:
            transfers come from the feed, independent of holdings' network loading/error/empty
            states — e.g. a fully-liquidated account has real transfers to show with zero
            current holdings.

            Same DayGroupHeader + TransactionRow the account and category sheets render, so a
            transfer greys out, badges "Transfer · Auto" and opens the same detail sheet here as
            everywhere else — none of which is re-implemented on this screen. */}
        {items.length > 0 ? (
          <>
            {/* Principal sits on the TRANSFERS row because it is the sum of exactly these rows —
                reading it beside the list it totals is what makes it self-explanatory.

                It covers only what the feed holds (~24 months from the investments endpoint), so
                on an older account it understates. No gain is derived from it for that reason:
                market value minus a windowed principal would report pre-window contributions as
                profit. The gain in the headline and rows is a different quantity and safe — it comes from the
                institution's own reported cost basis, which has no window. */}
            <View className="mb-1 mt-8 flex-row items-baseline justify-between">
              <Text className="font-sansSemi text-md text-textPrimary">Transfers</Text>
              {principal !== null ? (
                <Text className="font-sansSemi text-base text-textSecondary">
                  {/* Magnitude plus a direction word, not a signed amount: an account being drawn
                      down nets out negative, and "-$3,000.00 in" reads as a typo where
                      "$3,000.00 out" reads as the fact it is. */}
                  {formatMaskableAmount(Math.abs(principal), isMasked)} {principal < 0 ? 'out' : 'in'}
                </Text>
              ) : null}
            </View>
            <InvestmentTransferDays shownDays={shownDays} categoryById={categoryById} />
            {hiddenCount > 0 ? (
              <Text className="py-3 text-center font-sans text-xs text-textMuted">
                {hiddenCount} older {hiddenCount === 1 ? 'transfer' : 'transfers'} not shown
              </Text>
            ) : null}
          </>
        ) : null}
      </ScrollView>
    </BottomSheet>
  )
}

/**
 * The transfer rows, as their own component so they can read openTransaction from the provider's
 * context. The sheet body around them is created by InvestmentDetailSheet and therefore skipped
 * when the provider re-renders for an edit sheet; only this leaf subscribes.
 */
function InvestmentTransferDays({
  shownDays,
  categoryById,
}: {
  shownDays: { date: string; items: FeedItem[] }[]
  categoryById: Map<string, Category>
}) {
  const { openTransaction } = useTransactionEditorActions()
  return (
    <>
      {shownDays.map((day) => (
        <View key={day.date}>
          <DayGroupHeader date={day.date} items={day.items} />
          {day.items.map((item) => {
            const category = item.categoryId ? categoryById.get(item.categoryId) : undefined
            return (
              <View key={item.id} className="border-t" style={{ borderColor: colors.border }}>
                <TransactionRow
                  item={item}
                  categoryName={category?.name ?? 'Uncategorized'}
                  categoryColor={category?.color ?? colors.textMuted}
                  categoryIcon={category?.icon ?? null}
                  reimbursementCategoryName={
                    item.reimbursementCategoryId ? categoryById.get(item.reimbursementCategoryId)?.name ?? null : null
                  }
                  onPress={openTransaction}
                />
              </View>
            )
          })}
        </View>
      ))}
    </>
  )
}
