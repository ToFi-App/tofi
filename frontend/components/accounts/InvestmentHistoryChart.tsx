import { ActivityIndicator, Text, View, useWindowDimensions } from 'react-native'
import { colors } from '@/constants/theme'
import { TrendChart, type TrendSlot } from '@/components/visualizations/TrendChart'
import { RangePills } from '@/components/ui/RangePills'
import type { Granularity, TrendRange } from '@/lib/accounts/netWorthHistory'
import { formatMaskableAmount } from '@/lib/format/money'
import type { AccountHistory } from '@/lib/investments/accountHistory'

/**
 * The investment charts' pills. On the account chart 5Y and All both reach the ~24 months Plaid's
 * activity covers; a holding's chart reaches 5 years of prices.
 */
export const INVESTMENT_RANGES: TrendRange[] = ['1W', '1M', '3M', 'YTD', '1Y', '5Y', 'ALL']

const CHART_H = 220

interface InvestmentHistoryChartProps {
  history: AccountHistory
  /** The points in the window, and their slots — from visiblePoints over the shared viewport. */
  points: { value: number }[]
  slots: TrendSlot[]
  granularity: Granularity
  slotStart: number
  slotCount: number
  /** The value where the window opens, which the line's scale keeps in frame. */
  baseline: number
  /** The window's gain was positive: the line's colour, matching the headline above it. */
  isUp: boolean
  selectedIndex: number | null
  onSelect: (index: number | null) => void
  onZoomStart: () => void
  onZoomEnd: () => void
  onZoom: (scale: number, focus: number, drift: number) => void
  /** The pill whose window is showing, or null once a gesture has moved it. */
  activeRange: TrendRange | null
  onRangeChange: (range: TrendRange) => void
  isLoading: boolean
  isRateLimited: boolean
  tradesUnavailable: boolean
  isMasked: boolean
  /** Deposit and withdrawal dots on the line, with their tooltips. */
  markers?: Array<{ index: number; color: string; radius?: number; label?: string }>
}

/**
 * The account's value over a window, rebuilt from its trades, on the same zoomable chart as net
 * worth — tap or scrub a day, pinch to zoom, drag to pan — with its range pills and notes on what
 * it can't see. The window's gain is the sheet's headline above it, so this draws no figure of its
 * own. Coloured by that gain rather than the change in value: a deposit lifts the line but isn't
 * performance.
 */
export function InvestmentHistoryChart({
  history,
  points,
  slots,
  granularity,
  slotStart,
  slotCount,
  baseline,
  isUp,
  selectedIndex,
  onSelect,
  onZoomStart,
  onZoomEnd,
  onZoom,
  activeRange,
  onRangeChange,
  isLoading,
  isRateLimited,
  tradesUnavailable,
  isMasked,
  markers,
}: InvestmentHistoryChartProps) {
  const { width: windowW } = useWindowDimensions()

  return (
    <View>
      <View style={{ height: CHART_H }}>
        {points.length === 0 ? (
          <View className="flex-1 items-center justify-center">
            <Text className="font-sans text-sm text-textMuted">No history in this window</Text>
          </View>
        ) : (
          <TrendChart
            points={points}
            slots={slots}
            granularity={granularity}
            slotStart={slotStart}
            slotCount={slotCount}
            baseline={baseline}
            isUp={isUp}
            selectedIndex={selectedIndex}
            onSelect={onSelect}
            onZoomStart={onZoomStart}
            onZoomEnd={onZoomEnd}
            onZoom={onZoom}
            width={windowW}
            height={CHART_H}
            gradientId="investmentHistoryArea"
            markers={markers}
          />
        )}
      </View>

      <View className="px-4 pt-3">
        <RangePills ranges={INVESTMENT_RANGES} value={activeRange} onChange={onRangeChange} />
      </View>

      <View className="mt-3 px-5">
        {tradesUnavailable ? (
          <Text className="font-sans text-xs leading-5 text-textMuted">
            Past trades aren’t available from this brokerage, so this is today’s holdings priced at each day’s close.
          </Text>
        ) : null}
        {history.incomplete ? (
          // Unwinding the activity ran a position below zero: the brokerage's history is missing
          // rows, so earlier days undercount what was held.
          <Text className="font-sans text-xs leading-5 text-textMuted">
            Some older activity is missing from your brokerage&apos;s data, so earlier values may read low.
          </Text>
        ) : null}
        {history.flat.count > 0 ? (
          // Disclosed so a flat-looking line isn't read as flat performance: these holdings have no
          // daily prices (funds, bonds, crypto, options) or haven't loaded yet.
          <Text className="font-sans text-xs leading-5 text-textMuted">
            {history.flat.count} {history.flat.count === 1 ? 'holding' : 'holdings'} (
            {formatMaskableAmount(history.flat.value, isMasked)}) shown at today&apos;s price.
          </Text>
        ) : null}
        {isRateLimited || isLoading ? (
          <View className="mt-1 flex-row items-center gap-2">
            <ActivityIndicator size="small" color={colors.textMuted} />
            <Text className="font-sans text-xs text-textMuted">
              {isRateLimited ? 'Price history is busy. Retrying shortly.' : 'Loading price history…'}
            </Text>
          </View>
        ) : null}
      </View>
    </View>
  )
}
