import { useMemo } from 'react'
import { ScrollView, Text, View } from 'react-native'
import { BottomSheet, useSheetScroll } from '@/components/ui/BottomSheet'
import { DayGroupedTransactions, type RowCategory } from '@/components/transactions/DayGroupedTransactions'
import { useTransactionEditorActions } from '@/components/transactions/TransactionEditorProvider'
import { formatMaskableAmount } from '@/lib/format/money'
import type { FeedItem } from '@/lib/transactions/resolveFeed'
import { pairTransferLegs } from '@/lib/transfers/pairLegs'
import { TransferPairCard } from './TransferPairCard'

export interface FlowSelection {
  title: string
  subtitle: string
  color: string
  amount: number
  items: FeedItem[]
}

interface FlowTransactionsSheetProps {
  selection: FlowSelection | null
  categoryFor: (item: FeedItem) => RowCategory
  isMasked: boolean
  accountName: (accountId: string | null) => string
  onClose: () => void
}

/**
 * The rows behind one ribbon, lane or node, each editable in place like everywhere else in the app.
 * Transfers with both legs present are shown as one card per transfer rather than two rows, so the
 * list reads as money moving between accounts instead of unrelated debits and credits.
 */
export function FlowTransactionsSheet({ selection, categoryFor, isMasked, accountName, onClose }: FlowTransactionsSheetProps) {
  const sheetScroll = useSheetScroll()
  const { openTransaction } = useTransactionEditorActions()
  const { pairs, singles } = useMemo(() => pairTransferLegs(selection?.items ?? []), [selection])

  return (
    <BottomSheet visible={selection != null} onClose={onClose}>
      {selection ? (
        <ScrollView {...sheetScroll.scrollProps} showsVerticalScrollIndicator={false} className="px-5">
          <View className="items-center gap-1" style={{ marginBottom: 12 }}>
            <Text className="font-sansSemi text-md text-textPrimary">{selection.title}</Text>
            <Text className="font-sans text-sm text-textSecondary">{selection.subtitle}</Text>
            <Text className="font-display text-lg" style={{ color: selection.color }}>
              {formatMaskableAmount(selection.amount, isMasked)}
            </Text>
          </View>
          {pairs.length > 0 ? (
            <View className="gap-3" style={{ marginBottom: singles.length > 0 ? 16 : 0 }}>
              {pairs.map((pair) => (
                <TransferPairCard key={pair.transferId} pair={pair} accountName={accountName} isMasked={isMasked} onLegPress={openTransaction} />
              ))}
            </View>
          ) : null}
          {singles.length > 0 ? (
            <DayGroupedTransactions items={singles} categoryFor={categoryFor} onItemPress={openTransaction} />
          ) : null}
        </ScrollView>
      ) : null}
    </BottomSheet>
  )
}
