import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react'
import { Pressable, ScrollView, Text, View } from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { colors } from '@/constants/theme'
import { formatAmount } from '@/lib/format/money'
import { formatGainPct } from '@/lib/accounts/holdings'
import { computeFullTrend, trendNetWorth, type Granularity, type TrendPoint, type TrendRange } from '@/lib/accounts/netWorthHistory'
import {
  dayOf,
  futureBuffer,
  granularityFor,
  panViewport,
  rangeViewport,
  viewportBuckets,
  visiblePoints,
  zoomViewport,
  type Viewport,
} from '@/lib/accounts/trendViewport'
import { CASH_ON_HAND_KEY } from '@/lib/accounts/composition'
import { buildNetWorthSeries, periodStart, type NetWorthSeries } from '@/lib/accounts/netWorthSeries'
import { NetWorthTrendChart } from './NetWorthTrendChart'
import { NetWorthCompositionMap } from './NetWorthCompositionMap'
import { NetWorthAccountRows } from './NetWorthAccountRows'
import { BottomSheet, useSheetScroll } from '@/components/ui/BottomSheet'
import { TEAL_SHEET_BACKDROP } from '@/components/ui/TealSheetBackdrop'
import type { FeedItem } from '@/lib/transactions/resolveFeed'
import type { Account } from '@/types/domain'
import { SheetHeader } from '@/components/ui/SheetHeader'

interface NetWorthTrendSheetProps {
  visible: boolean
  onClose: () => void
  netWorth: number
  accounts: Account[]
  feed: FeedItem[]
  isLoading: boolean
}

// Deliberately exempt from the app-wide `useAmountsMasked` toggle: this sheet exists to show
// the net worth trajectory, and a chart of masked amounts would have nothing left to say.
// Every other balance surface (HeroCard, AccountRow, AccountDetailSheet) does honour it.
const TREND_RANGES: TrendRange[] = ['1W', '1M', '3M', 'YTD', '1Y', 'ALL']
const RANGE_LABELS: Record<TrendRange, string> = {
  '1W': 'Past week',
  '1M': 'Past month',
  '3M': 'Past 3 months',
  YTD: 'Year to date',
  '1Y': 'Past year',
  ALL: 'All time',
}

function changeColor(change: number): string {
  if (change > 0) return colors.income
  if (change < 0) return colors.expense
  return colors.textMuted
}

interface TrendPanelProps {
  /** The whole history at each resolution; the window picks one and slices it. */
  histories: Record<Granularity, TrendPoint[]>
  series: NetWorthSeries[]
  netWorth: number
  isLoading: boolean
  accounts: Account[]
  feed: FeedItem[]
}

/**
 * Everything that reads the chart — headline, chart, range pills, composition map, account rows —
 * and the state they share: the visible window, the selected point, the highlighted account.
 *
 * The state lives HERE rather than in the sheet on purpose. BottomSheet republishes its whole
 * tree to the sheet host after every render of its owner, so state held by the sheet made each
 * tap re-render everything, in two passes. Held down here, a tap or a pinch re-renders this
 * subtree and nothing else.
 */
function TrendPanel({ histories, series, netWorth, isLoading, accounts, feed }: TrendPanelProps) {
  const today = new Date()
  const todayIso = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`
  const todayDay = dayOf(todayIso)
  const earliestDay = histories.day[0] ? dayOf(histories.day[0].start) : todayDay
  const yearStartDay = dayOf(`${today.getFullYear()}-01-01`)
  const bounds = useMemo(() => ({ minDay: earliestDay, maxDay: todayDay }), [earliestDay, todayDay])

  // The pills set the window; pinching moves it and leaves no pill selected. Tapping a pill snaps
  // back to exactly its range.
  const [activeRange, setActiveRange] = useState<TrendRange | null>('YTD')
  const [viewport, setViewport] = useState<Viewport>(() => rangeViewport('YTD', todayDay, earliestDay, yearStartDay))
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
  const pendingViewport = useRef<Viewport | null>(null)
  const frameRequest = useRef<number | null>(null)
  useEffect(() => () => {
    if (frameRequest.current != null) cancelAnimationFrame(frameRequest.current)
  }, [])

  const span = viewport.endDay - viewport.startDay + 1
  const granularity = granularityFor(span)
  const accountPoints = useMemo(
    () => visiblePoints(histories[granularity], granularity, viewport),
    [histories, granularity, viewport],
  )
  // The slots the chart lays out: every bucket in the window, including any past today.
  const slots = useMemo(() => viewportBuckets(viewport, granularity), [viewport, granularity])
  // The line summed from the per-account history, so the bars and the line are one calculation.
  const points = useMemo(() => trendNetWorth(accountPoints), [accountPoints])
  const start = useMemo(() => periodStart(accountPoints), [accountPoints])
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
  // The map and the rows are the expensive part of a redraw, and nothing about them has to keep
  // pace with a finger. Deferred, the chart and headline update on every step of a scrub or slide
  // while these catch up whenever React has a moment — and skip steps they'd only redraw over.
  const detail = useDeferredValue(useMemo(() => ({ points: accountPoints, index: readIndex, start }), [accountPoints, readIndex, start]))
  const readPoint = detail.points[detail.index]
  // One highlighted account, set from a map tile or an account row and shown in all three.
  const [highlightedKey, setHighlightedKey] = useState<string | null>(null)

  return (
    <>
      <View className="px-5 pb-2 pt-1">
        <Text className="font-display text-2xl text-textPrimary">{formatAmount(reading?.netWorth ?? netWorth)}</Text>
        {reading ? (
          <View className="mt-1 flex-row items-center gap-1.5">
            {headlineChange !== 0 ? (
              <Ionicons name={headlineChange > 0 ? 'caret-up' : 'caret-down'} size={14} color={changeColor(headlineChange)} />
            ) : null}
            <Text className="font-sansSemi text-base" style={{ color: changeColor(headlineChange) }}>
              {formatAmount(Math.abs(headlineChange))}
              {headlinePct != null ? ` (${formatGainPct(headlinePct)})` : ''}
            </Text>
          </View>
        ) : null}
      </View>

      {points.length === 0 ? (
        <View className="items-center py-24">
          <Text className="font-sans text-sm text-textMuted">{isLoading ? 'Loading history…' : 'No history yet'}</Text>
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
          highlightedKey={highlightedKey}
        />
      )}

      <View className="flex-row justify-between px-5 pt-3">
        {TREND_RANGES.map((option) => {
          const isSelected = option === activeRange
          return (
            <Pressable
              key={option}
              onPress={() => chooseRange(option)}
              accessibilityLabel={RANGE_LABELS[option]}
              accessibilityState={{ selected: isSelected }}
              hitSlop={6}
              className="rounded-full px-3.5 py-1.5"
              style={isSelected ? { backgroundColor: colors.primary } : undefined}
            >
              <Text className="font-sansSemi text-sm" style={{ color: isSelected ? colors.surface : colors.primary }}>
                {option}
              </Text>
            </Pressable>
          )
        })}
      </View>

      {/* Below the chart rather than between it and the headline, which is the chart's reading.
          Sits directly above the account rows it summarizes, and follows the chart: the window
          in view and the point selected in it. */}
      {readPoint ? (
        <View className="px-5 pt-6">
          <NetWorthCompositionMap
            accounts={accounts}
            feed={feed}
            balances={readPoint.balances}
            selectedKey={highlightedKey}
            onSelectKey={setHighlightedKey}
          />
        </View>
      ) : null}

      {points.length > 0 ? (
        <NetWorthAccountRows
          months={detail.points}
          series={series}
          start={detail.start}
          index={detail.index}
          highlightedKey={highlightedKey}
          onHighlight={setHighlightedKey}
        />
      ) : null}
    </>
  )
}

export function NetWorthTrendSheet({ visible, onClose, netWorth, accounts, feed, isLoading }: NetWorthTrendSheetProps) {
  const insets = useSafeAreaInsets()
  const sheetScroll = useSheetScroll()

  const linkedAccountIds = useMemo(() => new Set(accounts.map((a) => a.account_id)), [accounts])

  const { series, anchors } = useMemo(() => buildNetWorthSeries(accounts, feed), [accounts, feed])
  // Cash accounts can't sit below zero and debt can't sit in credit, so a leftover of the wrong
  // sign before an account's first transaction means it didn't exist yet (see expectedSign).
  // Investments and the manual cash pot are left out on purpose.
  const expectedSign = useMemo(() => {
    const signs = new Map<string, 1 | -1>()
    for (const s of series) {
      if (s.key === CASH_ON_HAND_KEY || s.group === 'investment') continue
      signs.set(s.key, s.group === 'liability' ? -1 : 1)
    }
    return signs
  }, [series])
  // The whole history once per resolution. Zooming only slices these, so a pinch never re-walks
  // the ledger.
  const histories = useMemo(() => {
    const now = new Date()
    const at = (g: Granularity) => computeFullTrend(anchors, feed, linkedAccountIds, g, now, { expectedSign })
    return { day: at('day'), week: at('week'), month: at('month') }
  }, [anchors, feed, linkedAccountIds, expectedSign])

  return (
    <BottomSheet
      visible={visible}
      onClose={onClose}
      topOffset={insets.top + 20}
      contentScroll={sheetScroll}
      background={TEAL_SHEET_BACKDROP}
      // The default pill is near-white and disappears into the tinted top edge.
      grabberColor={colors.textMuted}
    >
      <SheetHeader title="Net Worth" onClose={onClose} />

      <ScrollView
        {...sheetScroll.scrollProps}
        // No horizontal padding here: the chart and the account rows run edge to edge, and every
        // other section carries its own 20px.
        contentContainerStyle={{ paddingBottom: insets.bottom + 24 }}
      >
        {/* Keyed by visibility, so every open starts on YTD with nothing selected. */}
        <TrendPanel
          key={String(visible)}
          histories={histories}
          series={series}
          netWorth={netWorth}
          isLoading={isLoading}
          accounts={accounts}
          feed={feed}
        />
      </ScrollView>
    </BottomSheet>
  )
}
