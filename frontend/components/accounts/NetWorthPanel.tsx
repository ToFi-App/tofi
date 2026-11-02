import { useMemo, useState, type ReactNode } from 'react'
import { Text, View } from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import { colors, spacing } from '@/constants/theme'
import { MASKED_AMOUNT, formatAmount, formatMaskableAmount } from '@/lib/format/money'
import { formatGainPct } from '@/lib/accounts/holdings'
import {
  computeFullTrend,
  overlayAccountHistories,
  trendNetWorth,
  type Granularity,
  type TrendRange,
} from '@/lib/accounts/netWorthHistory'
import { dayOf, viewportBuckets, visiblePoints } from '@/lib/accounts/trendViewport'
import { useNetWorthTrendInputs } from '@/hooks/useNetWorthTrendInputs'
import { TrendChart } from '@/components/visualizations/TrendChart'
import { useTrendViewport } from '@/hooks/useTrendViewport'
import { RangePills } from '@/components/ui/RangePills'
import { MaskToggle } from '@/components/ui/MaskToggle'
import { NetWorthScopePills } from '@/components/networth/NetWorthScopePills'
import type { FeedItem } from '@/lib/transactions/resolveFeed'
import type { Account } from '@/types/domain'

const TREND_RANGES: TrendRange[] = ['1M', '3M', 'YTD', '1Y', 'ALL']

// Every range draws one point per day — a year is 365 of them, never "Week of …" buckets. The
// chart's own default steps up to weeks and months as the window widens; here the finer grain wins.
const GRANULARITY: Granularity = 'day'

// Shorter than the chart's default, which was sized for a full-height sheet: here it shares the
// top of the Net Worth view with the headline and the account list.
const CHART_HEIGHT = 260

const DEFAULT_RANGE: TrendRange = '1M'

const NO_OVERLAYS = new Map<string, Array<{ date: string; value: number }>>()

function changeColor(change: number): string {
  if (change > 0) return colors.income
  if (change < 0) return colors.expense
  return colors.textMuted
}

interface NetWorthPanelProps {
  accounts: Account[]
  feed: FeedItem[]
  netWorth: number
  totalAssets: number
  totalLiabilities: number
  /** Balances are still loading: the headline shows a placeholder. */
  isLoading: boolean
  /** The feed is still loading: the chart says so rather than "No history yet". */
  isHistoryLoading: boolean
  isMasked: boolean
  /** The screen's own controls (adding an account), at the end of the Net Worth | Investments row. */
  actions?: ReactNode
  /**
   * Investment accounts' rebuilt daily values (useInvestmentHistories), by account id. Their bands
   * take these in place of the walk's, which can't see the market (overlayAccountHistories).
   */
  investmentHistories?: Map<string, Array<{ date: string; value: number }>>
}

/**
 * The top of the Net Worth tab's Overview: net worth and the totals it is made of, and its
 * history as a zoomable chart (tapping or scrubbing a point reads it into the headline). The
 * chart's gestures are horizontal only, so a vertical swipe over it still scrolls the page. What it
 * is made of is the account list under it, so there's no separate breakdown.
 *
 * Honours the app-wide hide toggle: every dollar figure reads as the mask. What stays is what
 * discloses no balance — the chart's shape and the change as a percentage.
 */
export function NetWorthPanel({
  accounts,
  feed,
  netWorth,
  totalAssets,
  totalLiabilities,
  isLoading,
  isHistoryLoading,
  isMasked,
  actions,
  investmentHistories,
}: NetWorthPanelProps) {
  const { linkedAccountIds, anchors, expectedSign } = useNetWorthTrendInputs(accounts, feed)
  // The whole history, day by day, once. Zooming only slices it, so a pinch never re-walks the
  // ledger.
  const history = useMemo(
    () =>
      overlayAccountHistories(
        computeFullTrend(anchors, feed, linkedAccountIds, GRANULARITY, new Date(), { expectedSign }),
        investmentHistories ?? NO_OVERLAYS,
      ),
    [anchors, feed, linkedAccountIds, expectedSign, investmentHistories],
  )

  const today = new Date()
  const todayIso = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`
  const todayDay = dayOf(todayIso)
  const earliestDay = history[0] ? dayOf(history[0].start) : todayDay
  const yearStartDay = dayOf(`${today.getFullYear()}-01-01`)
  const { activeRange, chooseRange, viewport, handleZoomStart, handleZoomEnd, handleZoom, selectedIndex, handleSelect } =
    useTrendViewport({ earliestDay, todayDay, yearStartDay, defaultRange: DEFAULT_RANGE })

  const granularity = GRANULARITY
  const accountPoints = useMemo(() => visiblePoints(history, granularity, viewport), [history, granularity, viewport])
  // The slots the chart lays out: every bucket in the window, including any past today.
  const slots = useMemo(() => viewportBuckets(viewport, granularity), [viewport, granularity])
  // The line summed from the per-account history.
  const points = useMemo(() => trendNetWorth(accountPoints), [accountPoints])
  const linePoints = useMemo(() => points.map((p) => ({ value: p.netWorth })), [points])
  // Net worth where the window opens: what the headline change, and the line's colour, measure from.
  const baseline = points.length > 0 ? points[0].netWorth - points[0].change : 0

  const readIndex = selectedIndex != null && selectedIndex < points.length ? selectedIndex : points.length - 1
  const reading = points[readIndex]
  const headlineChange = reading ? Math.round((reading.netWorth - baseline) * 100) / 100 : 0
  // Measured against where the window opens; none when it opened at or below zero, where a
  // percentage has no meaningful base.
  const headlinePct = baseline > 0 ? headlineChange / baseline : null

  // The chart runs the panel's full width, so it waits for the panel to be measured.
  const [panelWidth, setPanelWidth] = useState(0)

  // The point in view: today's figure until a point on the chart is read.
  const headline = reading?.netWorth ?? netWorth

  return (
    // Edge to edge: the negative margin cancels the screen's side padding, so the panel and its
    // chart use the full width of the screen. No background, corners or shadow — it's the top of
    // the page itself, not a card on it.
    <View
      className="pb-2 pt-1"
      style={{ marginHorizontal: -spacing[5] }}
      onLayout={(e) => setPanelWidth(e.nativeEvent.layout.width)}
    >
      {/* The tab's Overview | Investments switch, with the screen's controls at the other end of the row. */}
      <View className="flex-row items-center justify-between px-5">
        <NetWorthScopePills />
        <View className="flex-row items-center gap-4">
          {actions}
        </View>
      </View>

      <View className="mt-5 gap-1 px-5">
        {isLoading ? (
          <View className="h-9 w-36 rounded-md bg-surfaceRaised" />
        ) : (
          <MaskToggle>
            <Text className="shrink font-display text-2xl text-textPrimary" numberOfLines={1} adjustsFontSizeToFit>
              {formatMaskableAmount(headline, isMasked)}
            </Text>
          </MaskToggle>
        )}
        {reading ? (
          <View className="flex-row items-center gap-1.5">
            {headlineChange !== 0 ? (
              <Ionicons name={headlineChange > 0 ? 'caret-up' : 'caret-down'} size={12} color={changeColor(headlineChange)} />
            ) : null}
            {/* Hidden, only the percentage is left: direction without magnitude. */}
            <Text className="font-sansSemi text-sm" style={{ color: changeColor(headlineChange) }}>
              {isMasked
                ? formatGainPct(headlinePct)
                : `${formatAmount(Math.abs(headlineChange))}${headlinePct != null ? ` (${formatGainPct(headlinePct)})` : ''}`}
            </Text>
          </View>
        ) : null}
      </View>

      <View className="mt-3" style={{ height: CHART_HEIGHT }}>
        {points.length === 0 || panelWidth === 0 ? (
          <View className="flex-1 items-center justify-center">
            <Text className="font-sans text-sm text-textMuted">{isHistoryLoading ? 'Loading history…' : 'No history yet'}</Text>
          </View>
        ) : (
          <TrendChart
            points={linePoints}
            slots={accountPoints}
            granularity={granularity}
            slotStart={slots.first}
            slotCount={slots.count}
            baseline={baseline}
            selectedIndex={selectedIndex}
            onSelect={handleSelect}
            onZoomStart={handleZoomStart}
            onZoomEnd={handleZoomEnd}
            onZoom={handleZoom}
            width={panelWidth}
            height={CHART_HEIGHT}
            gradientId="netWorthArea"
          />
        )}
      </View>

      <View className="px-4 pt-3">
        <RangePills ranges={TREND_RANGES} value={activeRange} onChange={chooseRange} />
      </View>

      {/* Uppercase mono labels and mono figures, like the account console — without its wide tracking. */}
      <View className="flex-row justify-between px-5 pt-5">
        <View className="gap-1">
          <Text className="font-mono text-xs uppercase text-textSecondary">Total Assets</Text>
          <Text className="font-mono text-base text-textPrimary">{isMasked ? MASKED_AMOUNT : formatAmount(totalAssets)}</Text>
        </View>
        <View className="items-end gap-1">
          <Text className="font-mono text-xs uppercase text-textSecondary">Total Liabilities</Text>
          <Text className="font-mono text-base text-textPrimary">
            {isMasked ? MASKED_AMOUNT : formatAmount(totalLiabilities)}
          </Text>
        </View>
      </View>
    </View>
  )
}
