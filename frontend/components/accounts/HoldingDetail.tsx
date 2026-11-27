import { useEffect, useMemo, type ReactNode } from 'react'
import { Text, View, useWindowDimensions } from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import { colors, hexToRgba, spacing } from '@/constants/theme'
import { TrendChart } from '@/components/visualizations/TrendChart'
import { RangeTabs } from '@/components/networth/RangeTabs'
import { INVESTMENT_RANGES } from '@/components/accounts/InvestmentHistoryChart'
import { useTrendViewport } from '@/hooks/useTrendViewport'
import { markerRadius } from '@/lib/charts/markers'
import { averageCost, changeColor, formatGainPct, formatShares, holdingGain, holdingGainPct, holdingLabel } from '@/lib/accounts/holdings'
import { ChangeLabel } from '@/components/networth/ChangeLabel'
import { ListCard, ListCardValue, SectionTitle } from '@/components/networth/ListCard'
import { bucketOf, formatTrendLabel, type Granularity, type TrendRange } from '@/lib/accounts/netWorthHistory'
import { dayOf, viewportBuckets, visiblePoints } from '@/lib/accounts/trendViewport'
import { formatAmount, formatMaskableAmount } from '@/lib/format/money'
import { fillCalendarDays, holdingSymbol } from '@/lib/investments/accountHistory'
import { buildSecurityHistory, tradeMarkers, tradeTable } from '@/lib/investments/securityHistory'
import type { DailyClose, Holding, InvestmentActivity, Split } from '@/types/domain'

const GRANULARITY: Granularity = 'day'
const DEFAULT_RANGE: TrendRange = '1W'
const CHART_H = 220
/** Trades shown; the newest are the ones a page like this is read for. */
const TRADE_LIMIT = 20


interface HoldingDetailProps {
  holding: Holding
  inputs: { closes: Record<string, DailyClose[]>; splits: Split[]; activity: InvestmentActivity[] } | null
  earliest: string
  today: string
  isMasked: boolean
  /** Shown at the end of the price-change line: the ⓘ for how current the figures are. */
  info?: ReactNode
}

/**
 * One holding's page inside the account sheet: the stock's price over a window — the same zoomable
 * chart as the account, with buys and sells marked on it — then the position held in it, then its
 * trades as a table.
 *
 * The chart is the stock's price, not the position's value: a position's value jumps at every buy,
 * which isn't performance. How the user did is the position card's job — total return from cost
 * basis. Trade dots scale with the shares traded, and a selected dot reads "BUY 5 shares".
 * Prices are public, so the price figures ignore the hide toggle; everything about the position
 * honours it.
 */
export function HoldingDetail({ holding, inputs, earliest, today, isMasked, info }: HoldingDetailProps) {
  const { width: windowW } = useWindowDimensions()
  const symbol = holdingSymbol(holding)
  const activity = useMemo(
    () => (inputs?.activity ?? []).filter((r) => r.securityId === holding.securityId),
    [inputs, holding.securityId],
  )

  const series = useMemo(() => {
    if (!inputs || !symbol) return null
    return buildSecurityHistory({
      closes: inputs.closes[symbol] ?? [],
      splits: inputs.splits.filter((s) => s.symbol === symbol),
      activity,
      startDate: earliest,
      latestPrice: holding.institutionPrice,
      today,
    })
  }, [inputs, symbol, holding.institutionPrice, activity, earliest, today])

  const trendPoints = useMemo(
    // One point per calendar day, as the chart's scrub reads them (see fillCalendarDays).
    () => fillCalendarDays(series?.points ?? []).map((p) => ({ ...p, start: p.date, bucket: bucketOf(p.date, GRANULARITY) })),
    [series],
  )
  const { activeRange, chooseRange, viewport, handleZoomStart, handleZoomEnd, handleZoom, selectedIndex, handleSelect } =
    useTrendViewport({
      earliestDay: dayOf(earliest),
      todayDay: dayOf(today),
      yearStartDay: dayOf(`${today.slice(0, 4)}-01-01`),
      defaultRange: DEFAULT_RANGE,
    })
  // Each holding opens on the default window, not wherever the last one was left.
  useEffect(() => {
    chooseRange(DEFAULT_RANGE)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [holding.securityId])

  const visible = useMemo(() => visiblePoints(trendPoints, GRANULARITY, viewport), [trendPoints, viewport])
  const slots = useMemo(() => viewportBuckets(viewport, GRANULARITY), [viewport])
  const linePoints = useMemo(() => visible.map((p) => ({ value: p.price })), [visible])
  const readIndex = selectedIndex != null && selectedIndex < visible.length ? selectedIndex : visible.length - 1
  const reading = visible[readIndex]
  const opening = visible[0]
  const priceChange = reading && opening ? reading.price - opening.price : 0
  const pricePct = opening && opening.price > 0 ? priceChange / opening.price : null
  const hasChange = reading != null && opening != null && visible.length >= 2
  // Dot area grows with the shares traded, against the biggest trade in view (see markerRadius).
  const markers = useMemo(() => {
    const dayMarkers = tradeMarkers(series?.trades ?? [], visible.map((p) => p.date))
    const largest = Math.max(0, ...dayMarkers.map((m) => m.quantity))
    return dayMarkers.map((m) => ({
      index: m.index,
      // Trades are the user's own moves, not the market's, so they take the brand teal and grey rather
      // than the line's gain or loss colour.
      color: m.kind === 'buy' ? colors.primary : colors.textSecondary,
      radius: markerRadius(m.quantity, largest),
      label: m.label,
    }))
  }, [series, visible])

  const totalGain = holdingGain(holding)
  const totalPct = holdingGainPct(holding)
  const avg = averageCost(holding)
  const allTrades = useMemo(() => tradeTable(activity), [activity])
  const trades = allTrades.slice(0, TRADE_LIMIT)
  const hiddenTrades = allTrades.length - trades.length

  return (
    <View>
      <View className="items-start gap-1 pb-2">
        <Text className="font-sansMed text-sm text-textSecondary" numberOfLines={1}>
          {holdingLabel(holding)}
        </Text>
        <Text className="font-display text-xl text-textPrimary" style={{ letterSpacing: -0.4 }} numberOfLines={2}>
          {holding.name ?? holdingLabel(holding)}
        </Text>
        <Text className="mt-1 font-display text-2xl text-textPrimary" style={{ letterSpacing: -0.6, fontVariant: ['tabular-nums'] }}>
          {formatAmount(reading?.price ?? holding.institutionPrice ?? 0)}
        </Text>
        {hasChange || info ? (
          <View className="mt-1 flex-row items-center gap-2">
            {hasChange ? (
              // Price changes are public, so the chip ignores the hide toggle.
              <View className="rounded-full px-2.5 py-1" style={{ backgroundColor: hexToRgba(changeColor(priceChange), 0.12) }}>
                <ChangeLabel
                  change={priceChange}
                  text={`${formatAmount(Math.abs(priceChange))}${pricePct != null ? ` (${formatGainPct(pricePct)})` : ''}`}
                />
              </View>
            ) : null}
            {info}
          </View>
        ) : null}
      </View>

      {series ? (
        // Edge to edge, like the account's chart: the negative margin cancels the page's padding.
        <View className="mb-6 mt-3" style={{ marginHorizontal: -spacing[5] }}>
          <View style={{ height: CHART_H }}>
            {visible.length > 0 ? (
              <TrendChart
                points={linePoints}
                slots={visible}
                granularity={GRANULARITY}
                slotStart={slots.first}
                slotCount={slots.count}
                baseline={opening?.price ?? 0}
                selectedIndex={selectedIndex}
                onSelect={handleSelect}
                onZoomStart={handleZoomStart}
                onZoomEnd={handleZoomEnd}
                onZoom={handleZoom}
                width={windowW}
                height={CHART_H}
                gradientId="holdingPriceArea"
                markers={markers}
              />
            ) : (
              <View className="flex-1 items-center justify-center">
                <Text className="font-sans text-sm text-textMuted">
                  No prices in this window
                </Text>
              </View>
            )}
          </View>
          <RangeTabs ranges={INVESTMENT_RANGES} value={activeRange} onChange={chooseRange} />
        </View>
      ) : (
        <Text className="py-4 font-sans text-xs leading-5 text-textMuted">
          No daily prices for this holding, so there&apos;s no chart. Its value comes from your brokerage.
        </Text>
      )}

      <SectionTitle title="Your position" />
      {/* Two columns of label and figure, each pair on one line with a hairline under it. */}
      <View className="mt-1 flex-row flex-wrap" style={{ columnGap: 20 }}>
        <Stat label="Shares" value={formatShares(holding.quantity)} />
        <Stat label="Value" value={formatMaskableAmount(holding.institutionValue ?? 0, isMasked)} />
        <Stat label="Avg cost" value={avg != null ? formatAmount(avg) : '—'} />
        <Stat
          label="Total return"
          value={
            totalGain != null
              ? `${totalGain >= 0 ? '+' : '−'}${formatMaskableAmount(Math.abs(totalGain), isMasked)}`
              : '—'
          }
          color={totalGain != null ? changeColor(totalGain) : undefined}
        />
        {totalPct != null ? <Stat label="Return" value={formatGainPct(totalPct)} color={changeColor(totalGain)} /> : null}
      </View>

      {trades.length > 0 ? (
        <View className="mt-8 gap-3">
          <SectionTitle title="Activity" />
          <View>
            {trades.map((trade) => {
              const isBuy = trade.kind === 'buy'
              const tone = isBuy ? colors.primary : colors.textSecondary
              return (
                <View key={trade.id} className="pb-2">
                  <ListCard
                    mark={
                      <View className="items-center justify-center rounded-full" style={{ width: 36, height: 36, backgroundColor: hexToRgba(tone, 0.1) }}>
                        <Ionicons name={isBuy ? 'add' : 'remove'} size={18} color={tone} />
                      </View>
                    }
                    title={isBuy ? 'Buy' : 'Sell'}
                    subtitle={`${formatShares(trade.quantity)} shares at ${formatAmount(trade.price)}`}
                    right={
                      <>
                        <ListCardValue>{formatMaskableAmount(trade.quantity * trade.price, isMasked)}</ListCardValue>
                        <Text className="font-sans text-xs text-textSecondary">{formatTrendLabel(trade.date, 'day', 'short')}</Text>
                      </>
                    }
                  />
                </View>
              )
            })}
          </View>
          {hiddenTrades > 0 ? (
            <Text className="py-1 text-center font-sans text-xs text-textMuted">
              {hiddenTrades} older {hiddenTrades === 1 ? 'trade' : 'trades'} not shown
            </Text>
          ) : null}
        </View>
      ) : null}
    </View>
  )
}

function Stat({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <View
      className="flex-row items-baseline justify-between gap-2 py-3"
      style={{ width: '47%', flexGrow: 1, borderBottomWidth: 1, borderColor: colors.border }}
    >
      <Text className="font-sans text-sm text-textSecondary">{label}</Text>
      <Text className="font-sansSemi text-sm" style={{ color: color ?? colors.textPrimary, fontVariant: ['tabular-nums'] }} numberOfLines={1}>
        {value}
      </Text>
    </View>
  )
}
