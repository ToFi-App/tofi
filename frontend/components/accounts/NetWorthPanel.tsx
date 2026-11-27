import { useMemo, useState, type ReactNode } from 'react'
import { Text, View } from 'react-native'
import { spacing } from '@/constants/theme'
import {
  computeFullTrend,
  formatTrendLabel,
  overlayAccountHistories,
  trendNetWorth,
  type Granularity,
  type TrendRange,
} from '@/lib/accounts/netWorthHistory'
import { dayOf, viewportBuckets, visiblePoints } from '@/lib/accounts/trendViewport'
import { useNetWorthTrendInputs } from '@/hooks/useNetWorthTrendInputs'
import { TrendChart } from '@/components/visualizations/TrendChart'
import { useTrendViewport } from '@/hooks/useTrendViewport'
import { RANGE_LABELS, RangeTabs } from '@/components/networth/RangeTabs'
import { BalanceHeadline } from '@/components/networth/BalanceHeadline'
import { SectionTitle } from '@/components/networth/ListCard'
import type { FeedItem } from '@/lib/transactions/resolveFeed'
import type { Account } from '@/types/domain'
import { TAB_CHART_HEIGHT } from '@/components/networth/chartLayout'

const TREND_RANGES: TrendRange[] = ['1M', '3M', 'YTD', '1Y', 'ALL']

// Every range draws one point per day — a year is 365 of them, never "Week of …" buckets. The
// chart's own default steps up to weeks and months as the window widens; here the finer grain wins.
const GRANULARITY: Granularity = 'day'

// Shorter than the chart's default, which was sized for a full-height sheet: here it shares the
// top of the Net Worth view with the headline and the account list.

const DEFAULT_RANGE: TrendRange = '1M'

const NO_OVERLAYS = new Map<string, Array<{ date: string; value: number }>>()

interface NetWorthPanelProps {
  accounts: Account[]
  feed: FeedItem[]
  netWorth: number
  /** Balances are still loading: the headline shows a placeholder. */
  isLoading: boolean
  /** The feed is still loading: the chart says so rather than "No history yet". */
  isHistoryLoading: boolean
  isMasked: boolean
  /** The tab's header (NetWorthHeader), above the figure. */
  header?: ReactNode
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
 * discloses no balance — the chart's shape and the change as a percentage. What it is made of is
 * the account groups under it, each with its own total.
 */
export function NetWorthPanel({
  accounts,
  feed,
  netWorth,
  isLoading,
  isHistoryLoading,
  isMasked,
  header,
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

  // What the change is measured over: the window's name, or the day being read off the chart.
  const caption = selectedIndex != null && accountPoints[readIndex]
    ? formatTrendLabel(accountPoints[readIndex].start, granularity, 'long')
    : activeRange
      ? RANGE_LABELS[activeRange]
      : undefined

  return (
    // Edge to edge: the negative margin cancels the screen's side padding, so the chart and the
    // range tabs run the full width of the screen. It's the top of the page itself, not a card on it.
    <View
      className="pb-2"
      style={{ marginHorizontal: -spacing[5] }}
      onLayout={(e) => setPanelWidth(e.nativeEvent.layout.width)}
    >
      {header}

      <View className="mt-6">
        <BalanceHeadline
          label="Your net worth"
          value={headline}
          isLoading={isLoading}
          change={reading ? { amount: headlineChange, pct: headlinePct } : null}
          caption={caption}
          isMasked={isMasked}
        />
      </View>

      <View className="mt-7 px-5">
        <SectionTitle title="Trend" />
      </View>

      <View className="mt-2" style={{ height: TAB_CHART_HEIGHT }}>
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
            height={TAB_CHART_HEIGHT}
            gradientId="netWorthArea"
          />
        )}
      </View>

      <RangeTabs ranges={TREND_RANGES} value={activeRange} onChange={chooseRange} />
    </View>
  )
}
