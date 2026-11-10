import { memo } from 'react'
import { View } from 'react-native'
import { DayGroupHeader } from './DayGroupHeader'
import { TransactionRow } from './TransactionRow'
import { colors, shadow } from '@/constants/theme'
import { groupByDay } from '@/lib/transactions/groupByDay'
import type { FeedItem } from '@/lib/transactions/resolveFeed'

/** How a row should present its category. Resolved by the caller, since the Transactions tab looks
 *  each row's category up while the category sheet already knows they all share one. */
export interface RowCategory {
  name: string
  color: string
  /** Icon slug; null when the item has no category, which renders the uncategorized fallback. */
  icon: string | null
}

interface DayGroupedTransactionsProps {
  items: FeedItem[]
  categoryFor: (item: FeedItem) => RowCategory
  /** The category a reimbursement income leg paid back into, shown on that row. Defaults to none. */
  reimbursementCategoryNameFor?: (item: FeedItem) => string | null
  onItemPress: (item: FeedItem) => void
  /** The Transactions tab measures each day card to scroll its calendar to a tapped date. */
  onDayLayout?: (date: string, y: number) => void
  /**
   * Overrides the day card's own classes. Exists for onDayLayout's sake: onLayout reports y
   * relative to the immediate parent, so a caller that needs those offsets in scroll-content
   * coordinates cannot wrap this in a padding View and must inset the cards themselves.
   */
  cardClassName?: string
}

/**
 * A feed rendered as one shadowed card per day, each headed by its IN/OUT split. Shared by the
 * Transactions tab and the category detail sheet, which had grown separate copies of the same
 * grouping loop and card chrome — and, as a result, different answers for the same day.
 *
 * Renders every row it is given, excluded ones included: a swept outflow or a transfer leg still
 * belongs in the list (greyed, badged) so the user can see and edit it. Only the header totals
 * filter, via dayTotals.
 *
 * Plain Views rather than a SectionList because both callers already sit inside a ScrollView, and
 * nesting a virtualized list in one breaks its windowing.
 */
function DayGroupedTransactionsComponent({
  items,
  categoryFor,
  reimbursementCategoryNameFor,
  onItemPress,
  onDayLayout,
  cardClassName = 'mb-3 rounded-xl bg-surface px-4',
}: DayGroupedTransactionsProps) {
  return (
    <>
      {groupByDay(items).map((day) => (
        <View
          key={day.date}
          className={cardClassName}
          style={shadow.sm}
          onLayout={onDayLayout ? (event) => onDayLayout(day.date, event.nativeEvent.layout.y) : undefined}
        >
          <DayGroupHeader date={day.date} items={day.items} />
          {day.items.map((item) => {
            const category = categoryFor(item)
            return (
              <View key={item.id} className="border-t" style={{ borderColor: colors.border }}>
                <TransactionRow
                  item={item}
                  categoryName={category.name}
                  categoryColor={category.color}
                  categoryIcon={category.icon}
                  reimbursementCategoryName={reimbursementCategoryNameFor?.(item) ?? null}
                  onPress={onItemPress}
                />
              </View>
            )
          })}
        </View>
      ))}
    </>
  )
}

/**
 * Memoized, and the reason every callback prop above must be stable at the call site: this subtree
 * is a whole month of rows, and it sits as a sibling of the edit sheets. Without the memo, each of
 * the ten state changes a detail -> transfer -> detail round trip produces re-ran groupByDay and
 * rebuilt every row, on the JS thread, in the frame the sheet animation was trying to start.
 */
export const DayGroupedTransactions = memo(DayGroupedTransactionsComponent)
