import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Pressable, Text, View } from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import { colors, spacing } from '@/constants/theme'
import { MASKED_AMOUNT, formatAmount, formatMaskableAmount } from '@/lib/format/money'
import { formatGainPct } from '@/lib/accounts/holdings'
import { computeFullTrend, trendNetWorth, type Granularity, type TrendRange } from '@/lib/accounts/netWorthHistory'
import {
  dayOf,
  futureBuffer,
  panViewport,
  rangeViewport,
  viewportBuckets,
  visiblePoints,
  zoomViewport,
  type Viewport,
} from '@/lib/accounts/trendViewport'
import { useNetWorthTrendInputs } from '@/hooks/useNetWorthTrendInputs'
import type { NetWorthSeries, NetWorthSeriesGroup } from '@/lib/accounts/netWorthSeries'
import { NetWorthTrendChart } from './NetWorthTrendChart'
import { NetWorthCompositionMap } from './NetWorthCompositionMap'
import { GROUP_COLORS } from './netWorthPalette'
import type { FeedItem } from '@/lib/transactions/resolveFeed'
import type { Account } from '@/types/domain'

const TREND_RANGES: TrendRange[] = ['1M', '3M', 'YTD', '1Y', 'ALL']
const RANGE_LABELS: Record<TrendRange, string> = {
  '1W': 'Past week',
  '1M': 'Past month',
  '3M': 'Past 3 months',
  YTD: 'Year to date',
  '1Y': 'Past year',
  ALL: 'All time',
}

// Every range draws one point per day — a year is 365 of them, never "Week of …" buckets. The
// chart's own default steps up to weeks and months as the window widens; here the finer grain wins.
const GRANULARITY: Granularity = 'day'

// Shorter than the chart's default, which was sized for a full-height sheet: here it shares the
// top of the Accounts screen with the headline and the map.
const CHART_HEIGHT = 260

const DEFAULT_RANGE: TrendRange = '1M'

type PanelView = 'trend' | 'breakdown'
const VIEWS: { value: PanelView; label: string }[] = [
  { value: 'trend', label: 'Trend' },
  { value: 'breakdown', label: 'Breakdown' },
]

/** One pill: the view switch above the figure and the ranges under the chart share it, lettered like the account console's headers. */
function Pill({
  label,
  isSelected,
  onPress,
  accessibilityLabel,
}: {
  label: string
  isSelected: boolean
  onPress: () => void
  accessibilityLabel?: string
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityState={{ selected: isSelected }}
      hitSlop={6}
      className="rounded-full px-3 py-1.5"
      style={isSelected ? { backgroundColor: colors.primary } : undefined}
    >
      {/* The console's instrument lettering: uppercase mono, widely tracked. */}
      <Text
        className="font-mono text-xs uppercase"
        style={{ color: isSelected ? colors.surface : colors.primary, letterSpacing: 1.6 }}
      >
        {label}
      </Text>
    </Pressable>
  )
}

const GROUP_LABELS: Record<NetWorthSeriesGroup, string> = {
  investment: 'Investments',
  cash: 'Cash',
  liability: 'Liabilities',
}

/**
 * Each group's share of the treemap: its balances' magnitude over assets plus debt, the same base
 * the map sizes its tiles against, so the legend's percentages match the areas drawn. Empty groups
 * are left out.
 */
function shareByGroup(series: NetWorthSeries[], balances: Map<string, number>) {
  const totals: Record<NetWorthSeriesGroup, number> = { investment: 0, cash: 0, liability: 0 }
  for (const s of series) totals[s.group] += Math.abs(balances.get(s.key) ?? 0)
  const whole = totals.investment + totals.cash + totals.liability
  if (whole === 0) return []
  return (['investment', 'cash', 'liability'] as const)
    .filter((group) => totals[group] > 0)
    .map((group) => ({ group, share: totals[group] / whole }))
}

/** A share as the legend prints it. A real sliver says "<1%" rather than rounding away to 0%. */
function formatShare(share: number): string {
  const pct = share * 100
  return pct > 0 && pct < 1 ? '<1%' : `${Math.round(pct)}%`
}

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
  onToggleMask: () => void
  /** The screen's own controls (adding an account), drawn beside the eye button. */
  actions?: ReactNode
}

/**
 * The top of the Accounts screen: net worth and the totals it is made of, with two views of it
 * switched by the pills above the figure — Trend, its history as a zoomable chart (tapping or
 * scrubbing a point reads it into the headline), and Breakdown, a treemap of what it is made of
 * today. The chart's gestures are horizontal only, so a vertical swipe over it still scrolls the page.
 *
 * Honours the app-wide hide toggle: every dollar figure reads as the mask. What stays is what
 * discloses no balance — the chart's shape, the map's shares, and the change as a percentage.
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
  onToggleMask,
  actions,
}: NetWorthPanelProps) {
  const { linkedAccountIds, series, anchors, expectedSign } = useNetWorthTrendInputs(accounts, feed)
  // The whole history, day by day, once. Zooming only slices it, so a pinch never re-walks the
  // ledger.
  const history = useMemo(
    () => computeFullTrend(anchors, feed, linkedAccountIds, GRANULARITY, new Date(), { expectedSign }),
    [anchors, feed, linkedAccountIds, expectedSign],
  )

  const today = new Date()
  const todayIso = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`
  const todayDay = dayOf(todayIso)
  const earliestDay = history[0] ? dayOf(history[0].start) : todayDay
  const yearStartDay = dayOf(`${today.getFullYear()}-01-01`)
  const bounds = useMemo(() => ({ minDay: earliestDay, maxDay: todayDay }), [earliestDay, todayDay])

  // The pills set the window; pinching moves it and leaves no pill selected. Tapping a pill snaps
  // back to exactly its range.
  const [activeRange, setActiveRange] = useState<TrendRange | null>(DEFAULT_RANGE)
  const [viewport, setViewport] = useState<Viewport>(() => rangeViewport(DEFAULT_RANGE, todayDay, earliestDay, yearStartDay))
  const chooseRange = (range: TrendRange) => {
    setActiveRange(range)
    setViewport(rangeViewport(range, todayDay, earliestDay, yearStartDay))
  }
  // History can arrive after the first render (the feed loads): keep a pill's window in step.
  useEffect(() => {
    if (activeRange) setViewport(rangeViewport(activeRange, todayDay, earliestDay, yearStartDay))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [earliestDay, todayDay])

  // A pinch is applied as totals to the window as it stood when the pinch began.
  const viewportRef = useRef(viewport)
  viewportRef.current = viewport
  const pinchBase = useRef({ viewport, scale: 1, focus: 0.5, drift: 0 })
  // The pinch and the two-finger drag start and end separately; the window is noted when the
  // first begins, so whichever comes second doesn't reset the other's progress.
  const activeZooms = useRef(0)
  const handleZoomStart = useCallback(() => {
    if (activeZooms.current === 0) pinchBase.current = { viewport: viewportRef.current, scale: 1, focus: 0.5, drift: 0 }
    activeZooms.current += 1
  }, [])
  const handleZoomEnd = useCallback(() => {
    activeZooms.current = Math.max(0, activeZooms.current - 1)
  }, [])
  const pendingViewport = useRef<Viewport | null>(null)
  const frameRequest = useRef<number | null>(null)
  const handleZoom = useCallback(
    (scale: number, focus: number, drift: number) => {
      const base = pinchBase.current
      // The pinch and the two-finger drag report separately; each keeps its latest total here.
      if (scale > 0) {
        base.scale = scale
        base.focus = focus
      } else {
        base.drift = drift
      }
      // Gestures may carry the window a little past today (futureBuffer), sized to the window
      // they produce so a year view gets proportionally more room than a week.
      const pastToday = (span: number) => ({ ...bounds, maxDay: bounds.maxDay + futureBuffer(span) })
      const baseSpan = base.viewport.endDay - base.viewport.startDay + 1
      const zoomed = zoomViewport(base.viewport, base.scale, base.focus, pastToday(Math.round(baseSpan / base.scale)))
      const span = zoomed.endDay - zoomed.startDay + 1
      // Fingers moving right drag the chart right, which brings earlier days into view.
      pendingViewport.current = panViewport(zoomed, -base.drift * span, pastToday(span))
      // Gestures report faster than the screen draws; apply the latest once per frame, and only
      // when it lands on different days — sub-day finger movement redraws nothing.
      if (frameRequest.current != null) return
      frameRequest.current = requestAnimationFrame(() => {
        frameRequest.current = null
        const next = pendingViewport.current
        if (!next) return
        setViewport((current) =>
          current.startDay === next.startDay && current.endDay === next.endDay ? current : next,
        )
        setActiveRange(null)
      })
    },
    [bounds],
  )
  useEffect(() => () => {
    if (frameRequest.current != null) cancelAnimationFrame(frameRequest.current)
  }, [])

  const granularity = GRANULARITY
  const accountPoints = useMemo(() => visiblePoints(history, granularity, viewport), [history, granularity, viewport])
  // The slots the chart lays out: every bucket in the window, including any past today.
  const slots = useMemo(() => viewportBuckets(viewport, granularity), [viewport, granularity])
  // The line summed from the per-account history.
  const points = useMemo(() => trendNetWorth(accountPoints), [accountPoints])
  // Net worth where the window opens: what the headline change, and the line's colour, measure from.
  const baseline = points.length > 0 ? points[0].netWorth - points[0].change : 0

  // Everything that reads a point follows the selection, and falls back to the latest one in view
  // when nothing is selected. The window moving makes an old index meaningless, so it clears.
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null)
  useEffect(() => {
    setSelectedIndex((current) => (current === null ? current : null))
  }, [viewport.startDay, viewport.endDay, granularity])
  const handleSelect = useCallback((index: number | null) => setSelectedIndex(index), [])
  const readIndex = selectedIndex != null && selectedIndex < points.length ? selectedIndex : points.length - 1
  const reading = points[readIndex]
  const headlineChange = reading ? Math.round((reading.netWorth - baseline) * 100) / 100 : 0
  // Measured against where the window opens; none when it opened at or below zero, where a
  // percentage has no meaningful base.
  const headlinePct = baseline > 0 ? headlineChange / baseline : null
  // The tapped treemap tile, which the map labels when its own tile is too small to.
  const [selectedTile, setSelectedTile] = useState<string | null>(null)
  const groupShares = useMemo(() => shareByGroup(series, anchors), [series, anchors])

  // The chart runs the panel's full width, so it waits for the panel to be measured.
  const [panelWidth, setPanelWidth] = useState(0)

  const [view, setView] = useState<PanelView>('trend')
  const isTrend = view === 'trend'
  // The breakdown shows today, so the headline does too; the trend reads the point in view.
  const headline = isTrend ? (reading?.netWorth ?? netWorth) : netWorth

  return (
    // Edge to edge: the negative margin cancels the screen's side padding, so the panel and its
    // chart use the full width of the screen. No background, corners or shadow — it's the top of
    // the page itself, not a card on it.
    <View
      className="pb-2 pt-1"
      style={{ marginHorizontal: -spacing[5] }}
      onLayout={(e) => setPanelWidth(e.nativeEvent.layout.width)}
    >
      {/* Which view the panel shows, with the screen's controls at the other end of the row. */}
      <View className="flex-row items-center justify-between px-5">
        <View className="flex-row gap-2">
          {VIEWS.map((option) => (
            <Pill key={option.value} label={option.label} isSelected={option.value === view} onPress={() => setView(option.value)} />
          ))}
        </View>
        <View className="flex-row items-center gap-4">
          <Pressable onPress={onToggleMask} hitSlop={8} accessibilityLabel={isMasked ? 'Show amounts' : 'Hide amounts'}>
            <Ionicons name={isMasked ? 'eye-off' : 'eye'} size={20} color={colors.textMuted} />
          </Pressable>
          {actions}
        </View>
      </View>

      <View className="mt-5 gap-1 px-5">
        {isLoading ? (
          <View className="h-9 w-36 rounded-md bg-surfaceRaised" />
        ) : (
          <Text className="font-display text-2xl text-textPrimary" numberOfLines={1} adjustsFontSizeToFit>
            {formatMaskableAmount(headline, isMasked)}
          </Text>
        )}
        {isTrend && reading ? (
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

      {isTrend ? (
        <>
          <View className="mt-3" style={{ height: CHART_HEIGHT }}>
            {points.length === 0 || panelWidth === 0 ? (
              <View className="flex-1 items-center justify-center">
                <Text className="font-sans text-sm text-textMuted">{isHistoryLoading ? 'Loading history…' : 'No history yet'}</Text>
              </View>
            ) : (
              <NetWorthTrendChart
                points={points}
                accountPoints={accountPoints}
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
              />
            )}
          </View>

          <View className="flex-row justify-between px-4 pt-3">
            {TREND_RANGES.map((option) => (
              <Pill
                key={option}
                label={option === 'ALL' ? 'All' : option}
                accessibilityLabel={RANGE_LABELS[option]}
                isSelected={option === activeRange}
                onPress={() => chooseRange(option)}
              />
            ))}
          </View>
        </>
      ) : (
        // Today's make-up of net worth, in the space the chart takes, under a legend of what each
        // colour is and how much of the map it covers.
        <View className="mt-4 gap-3 px-5">
          <View className="flex-row flex-wrap gap-x-4 gap-y-1">
            {groupShares.map(({ group, share }) => (
              <View key={group} className="flex-row items-center gap-1.5">
                <View className="h-2.5 w-2.5" style={{ borderRadius: 3, backgroundColor: GROUP_COLORS[group].fill }} />
                <Text className="font-mono text-xs uppercase text-textSecondary">{GROUP_LABELS[group]}</Text>
                <Text className="font-mono text-xs" style={{ color: GROUP_COLORS[group].text }}>
                  {formatShare(share)}
                </Text>
              </View>
            ))}
          </View>
          <NetWorthCompositionMap accounts={accounts} feed={feed} selectedKey={selectedTile} onSelectKey={setSelectedTile} />
        </View>
      )}

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
