import { useCallback } from 'react'
import { ScrollView, Text, View } from 'react-native'
import { BottomSheet, useSheetScroll } from '@/components/ui/BottomSheet'
import type { SheetScroll } from '@/components/ui/BottomSheet'
import { DayGroupedTransactions } from '@/components/transactions/DayGroupedTransactions'
import {
  useTransactionEditorActions,
} from '@/components/transactions/TransactionEditorProvider'
import { CategoryIcon } from '@/components/categories/CategoryIcon'
import { hexToRgba } from '@/constants/theme'
import { formatAmount } from '@/lib/format/money'
import type { FeedItem } from '@/lib/transactions/resolveFeed'
import type { DonutSegment } from '@/lib/transactions/visualizationData'
import { CategoryDonut } from './CategoryDonut'
import { SheetHeader } from '@/components/ui/SheetHeader'

interface CategoryDetailSheetProps {
  visible: boolean
  segment: DonutSegment | null
  allSegments: DonutSegment[]
  /** The rows to display — this segment's slice of the feed. */
  transactions: FeedItem[]
  /** The whole feed. Editing needs context the displayed slice doesn't carry: reimbursement
   *  candidates can sit in any category, and the delete warning has to know whether a
   *  transaction is part of a reimbursement. */
  feed: FeedItem[]
  onClose: () => void
}

/**
 * Split out so it can be the provider's `children`: an element created by the wrapper below and
 * therefore unchanged when the provider re-renders for a sheet, which is what stops this list
 * rebuilding every time a row is opened.
 */
function CategoryDetailSheetBody({
  segment,
  allSegments,
  transactions,
  sheetScroll,
}: {
  segment: DonutSegment
  allSegments: DonutSegment[]
  transactions: FeedItem[]
  sheetScroll: SheetScroll
}) {
  // Wired here rather than by the caller so every row this sheet shows is editable, matching
  // AccountDetailSheet. openTransaction routes by source — Plaid rows open the detail sheet,
  // manual rows the manual sheet — which is what keeps a manual row from being saved as a
  // transaction_override keyed on its uuid.
  const { openTransaction } = useTransactionEditorActions()
  // Stable so DayGroupedTransactions' memo holds.
  const categoryFor = useCallback(
    () => ({ name: segment.name, color: segment.color, icon: segment.icon }),
    [segment.name, segment.color, segment.icon],
  )

  return (
    <ScrollView {...sheetScroll.scrollProps} showsVerticalScrollIndicator={false} className="px-5">
      <CategoryDonut segments={allSegments} highlightedCategoryId={segment.categoryId} size={180} />

      <View className="flex-row items-center justify-center gap-2" style={{ marginTop: 8, marginBottom: 12 }}>
        <View
          className="items-center justify-center rounded-full"
          style={{ width: 28, height: 28, backgroundColor: hexToRgba(segment.color, 0.2) }}
        >
          <CategoryIcon icon={segment.icon} size={14} color={segment.color} />
        </View>
        <Text className="font-sansSemi text-md text-textPrimary">{segment.name}</Text>
        <Text className="font-display text-md" style={{ color: segment.color }}>
          {formatAmount(segment.amount)}
        </Text>
      </View>

      {transactions.length === 0 ? (
        <View style={{ paddingVertical: 24, alignItems: 'center' }}>
          <Text className="font-sans text-sm text-textMuted">No transactions</Text>
        </View>
      ) : (
        // Every row here is this segment's category by construction, so it presents the segment's
        // own name and colour rather than looking each row up.
        <DayGroupedTransactions items={transactions} categoryFor={categoryFor} onItemPress={openTransaction} />
      )}
    </ScrollView>
  )
}

export function CategoryDetailSheet({ visible, segment, allSegments, transactions, feed, onClose }: CategoryDetailSheetProps) {
  const sheetScroll = useSheetScroll()

  if (!segment) return null

  return (
    <BottomSheet visible={visible} onClose={onClose} contentScroll={sheetScroll}>
      <SheetHeader title={segment.name} onClose={onClose} />
      {/* No provider here: it is mounted once in the tabs layout. See AuthedShell there. */}
      <CategoryDetailSheetBody
          segment={segment}
          allSegments={allSegments}
          transactions={transactions}
          sheetScroll={sheetScroll}
        />
    </BottomSheet>
  )
}
