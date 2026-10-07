import { useEffect, useMemo } from 'react'
import { Text, View, useWindowDimensions } from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import { colors, spacing } from '@/constants/theme'
import { TrendChart } from '@/components/visualizations/TrendChart'
import { RangePills } from '@/components/ui/RangePills'
import { INVESTMENT_RANGES } from '@/components/accounts/InvestmentHistoryChart'
import { useTrendViewport } from '@/hooks/useTrendViewport'
import { markerRadius } from '@/lib/charts/markers'
import { averageCost, formatGainPct, formatShares, holdingGain, holdingGainPct, holdingLabel } from '@/lib/accounts/holdings'
import { bucketOf, formatTrendLabel, type Granularity, type TrendRange } from '@/lib/accounts/netWorthHistory'
import { dayOf, viewportBuckets, visiblePoints } from '@/lib/accounts/trendViewport'
import { formatAmount, formatMaskableAmount } from '@/lib/format/money'
import { fillCalendarDays, priceableSymbol } from '@/lib/investments/accountHistory'
import { buildSecurityHistory, tradeMarkers, tradeTable } from '@/lib/investments/securityHistory'
import type { DailyClose, Holding, InvestmentActivity, Split } from '@/types/domain'

const GRANULARITY: Granularity = 'day'
const DEFAULT_RANGE: TrendRange = '1W'
const CHART_H = 220
/** Trades shown; the newest are the ones a page like this is read for. */
const TRADE_LIMIT = 20

/** The trades table's columns: shares of the row, figures right-aligned so digits line up. */
const COLUMNS = {
  kind: { flex: 0.8 },
  date: { flex: 1.6 },
  quantity: { flex: 0.9, textAlign: 'right' as const },
  price: { flex: 1.2, textAlign: 'right' as const },
}

interface HoldingDetailProps {
  holding: Holding
  inputs: { closes: Record<string, DailyClose[]>; splits: Split[]; activity: InvestmentActivity[] } | null
  earliest: string
  today: string
  isMasked: boolean
}

function gainColor(value: number): string {
  return value >= 0 ? colors.income : colors.expense
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
export function HoldingDetail({ holding, inputs, earliest, today, isMasked }: HoldingDetailProps) {
  const { width: windowW } = useWindowDimensions()
  const symbol = priceableSymbol({ ticker: holding.ticker, type: holding.type, isOption: holding.optionContract != null })
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
  // Dot area grows with the shares traded, against the biggest trade in view (see markerRadius).
  const markers = useMemo(() => {
    const dayMarkers = tradeMarkers(series?.trades ?? [], visible.map((p) => p.date))
    const largest = Math.max(0, ...dayMarkers.map((m) => m.quantity))
    return dayMarkers.map((m) => ({
      index: m.index,
      color: m.kind === 'buy' ? colors.income : colors.expense,
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
      <View className="items-start pb-2">
        <Text className="font-sansMed text-sm text-textSecondary" numberOfLines={1}>
          {holding.name ?? holdingLabel(holding)}
        </Text>
        <Text className="font-display text-2xl text-textPrimary">
          {formatAmount(reading?.price ?? holding.institutionPrice ?? 0)}
        </Text>
        {reading && opening && visible.length >= 2 ? (
          <View className="mt-1 flex-row items-center gap-1.5">
            {priceChange !== 0 ? (
              <Ionicons name={priceChange > 0 ? 'caret-up' : 'caret-down'} size={14} color={gainColor(priceChange)} />
            ) : null}
            <Text className="font-sansSemi text-base" style={{ color: gainColor(priceChange) }}>
              {formatAmount(Math.abs(priceChange))}
              {pricePct != null ? ` (${formatGainPct(pricePct)})` : ''}
            </Text>
          </View>
        ) : null}
      </View>

      {series ? (
        // Edge to edge, like the account's chart: the negative margin cancels the sheet's padding.
        <View className="mb-6 mt-2" style={{ marginHorizontal: -spacing[5] }}>
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
          <View className="px-4 pt-3">
            <RangePills ranges={INVESTMENT_RANGES} value={activeRange} onChange={chooseRange} />
          </View>
        </View>
      ) : (
        <Text className="py-4 font-sans text-xs leading-5 text-textMuted">
          No daily prices for this holding, so there&apos;s no chart. Its value comes from your brokerage.
        </Text>
      )}

      <Text className="font-sansSemi text-md text-textPrimary">Your position</Text>
      <View className="mt-2 flex-row flex-wrap">
        <Stat label="Shares" value={formatShares(holding.quantity)} />
        <Stat label="Value" value={formatMaskableAmount(holding.institutionValue ?? 0, isMasked)} />
        <Stat label="Average cost" value={avg != null ? formatAmount(avg) : '—'} />
        <Stat
          label="Total return"
          value={
            totalGain != null
              ? `${totalGain >= 0 ? '+' : '-'}${formatMaskableAmount(Math.abs(totalGain), isMasked)}${totalPct != null ? ` (${formatGainPct(totalPct)})` : ''}`
              : '—'
          }
          color={totalGain != null ? gainColor(totalGain) : undefined}
        />
      </View>

      {trades.length > 0 ? (
        <>
          <Text className="mt-8 font-sansSemi text-md text-textPrimary">Trades</Text>
          {/* Uppercase mono headers and mono figures, like the account console, so the columns line
              up digit for digit. */}
          <View className="mt-2 flex-row pb-2">
            <Text className="font-mono text-xs uppercase text-textSecondary" style={COLUMNS.kind}>Type</Text>
            <Text className="font-mono text-xs uppercase text-textSecondary" style={COLUMNS.date}>Date</Text>
            <Text className="font-mono text-xs uppercase text-textSecondary" style={COLUMNS.quantity}>Qty</Text>
            <Text className="font-mono text-xs uppercase text-textSecondary" style={COLUMNS.price}>Avg cost</Text>
          </View>
          {trades.map((trade) => (
            <View key={trade.id} className="flex-row items-center border-t py-3" style={{ borderColor: colors.border }}>
              <Text
                className="font-mono text-sm"
                style={[COLUMNS.kind, { color: trade.kind === 'buy' ? colors.income : colors.expense }]}
              >
                {trade.kind === 'buy' ? 'BUY' : 'SELL'}
              </Text>
              <Text className="font-mono text-sm text-textPrimary" style={COLUMNS.date}>
                {formatTrendLabel(trade.date, 'day', 'long')}
              </Text>
              <Text className="font-mono text-sm text-textPrimary" style={COLUMNS.quantity}>
                {formatShares(trade.quantity)}
              </Text>
              <Text className="font-mono text-sm text-textPrimary" style={COLUMNS.price}>
                {formatAmount(trade.price)}
              </Text>
            </View>
          ))}
          {hiddenTrades > 0 ? (
            <Text className="py-3 text-center font-sans text-xs text-textMuted">
              {hiddenTrades} older {hiddenTrades === 1 ? 'trade' : 'trades'} not shown
            </Text>
          ) : null}
        </>
      ) : null}
    </View>
  )
}

function Stat({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <View className="w-1/2 py-2 pr-3">
      <Text className="font-sans text-xs text-textMuted">{label}</Text>
      <Text className="font-sansSemi text-base" style={{ color: color ?? colors.textPrimary }} numberOfLines={1}>
        {value}
      </Text>
    </View>
  )
}
