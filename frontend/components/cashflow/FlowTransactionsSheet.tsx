import { ScrollView, Text, View } from 'react-native'
import { BottomSheet, useSheetScroll } from '@/components/ui/BottomSheet'
import { DayGroupedTransactions, type RowCategory } from '@/components/transactions/DayGroupedTransactions'
import { useTransactionEditorActions } from '@/components/transactions/TransactionEditorProvider'
import { formatMaskableAmount } from '@/lib/format/money'
import type { FeedItem } from '@/lib/transactions/resolveFeed'

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
  onClose: () => void
}

/** The rows behind one ribbon or node, each editable in place like everywhere else in the app. */
export function FlowTransactionsSheet({ selection, categoryFor, isMasked, onClose }: FlowTransactionsSheetProps) {
  const sheetScroll = useSheetScroll()
  const { openTransaction } = useTransactionEditorActions()

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
          <DayGroupedTransactions items={selection.items} categoryFor={categoryFor} onItemPress={openTransaction} />
        </ScrollView>
      ) : null}
    </BottomSheet>
  )
}
