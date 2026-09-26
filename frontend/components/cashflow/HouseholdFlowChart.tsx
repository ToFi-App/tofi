import { useCallback, useEffect, useMemo, useState } from 'react'
import { Pressable, Text, View, useWindowDimensions } from 'react-native'
import { Gesture, GestureDetector } from 'react-native-gesture-handler'
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated'
import { Ionicons } from '@expo/vector-icons'
import { AccountGlyph } from '@/components/accounts/AccountGlyph'
import Svg, { G, Path, Rect, Text as SvgText } from 'react-native-svg'
import { colors, fontFamily, hexToRgba } from '@/constants/theme'
import { MASKED_AMOUNT, formatCompactMaskableAmount, formatMaskableAmount } from '@/lib/format/money'
import type { AccountRole } from '@/lib/cashflow/accountRole'
import {
  laneAmountText,
  layoutHousehold,
  pillWidth,
  type AccountCard,
  type HouseholdFlow,
  type Lane,
  type Ribbon,
  type SideNode,
} from '@/lib/cashflow/householdFlow'
import { MAX_SCALE, clampOffset, fitTransform, minScale } from '@/lib/cashflow/zoom'
import { laneColor, ribbonColor, roleColors, type NodeMeta } from './flowStyle'

/** Widest an edge label area gets; labels past LABEL_MAX_CHARS are truncated to fit it. */
const MAX_LABEL_WIDTH = 150
/** Rough advance widths for the edge labels' two fonts, erring wide like the card estimates. */
const LABEL_CHAR_WIDTH = 6.6
const AMOUNT_CHAR_WIDTH = 6.2
const BAR_WIDTH = 8
/** Narrowest a card gets; wider when an account name needs it. */
const MIN_CARD_WIDTH = 132
/** Rough advance widths for the card's two fonts. SVG text can't be measured before layout, so
 *  these err wide: a little spare room beats a name running over the card's edge. */
const NAME_CHAR_WIDTH = 7.2
const BALANCE_CHAR_WIDTH = 6.8
const CARD_TEXT_PADDING = 12
const LABEL_GAP = 6
const LABEL_MAX_CHARS = 22
const GLYPH_SIZE = 18
/** Card text starts after the glyph. */
const CARD_TEXT_X = 10 + GLYPH_SIZE + 6

/** The viewport's height as a share of the screen: most of it, so the chart can be read at a
 *  useful zoom once the user scrolls it into the middle of the screen. */
const VIEWPORT_SCREEN_FRACTION = 0.75

const LAYOUT = {
  barWidth: BAR_WIDTH,
  ribbonSpan: 70,
  trackGap: 26,
  // Tall enough for the name and balance lines; cards grow past this only for lane ports.
  minCard: 64,
  cardGap: 18,
  portGap: 14,
  minSlot: 36,
  /** Floor for the outside columns' height when the account column is short. */
  targetHeight: 200,
  laneMin: 2,
  laneMax: 8,
}

function truncate(label: string, max: number): string {
  return label.length > max ? `${label.slice(0, max - 1)}…` : label
}

/**
 * The account's net for the month, signed the way its own balance moves. A card's balance is
 * inverted — it rises as you spend and falls as you pay — so its net is flipped: charging more than
 * you paid reads positive, paying it down reads negative.
 */
function balanceLine(card: AccountCard, isMasked: boolean): string {
  const shown = card.role === 'debt' ? -card.balanceChange : card.balanceChange
  return `${shown > 0 ? '+' : shown < 0 ? '−' : ''}${formatMaskableAmount(Math.abs(shown), isMasked)}`
}

/**
 * Green when the month left the user better off in this account, red when it cost them. Decided
 * on the account's value, not the displayed sign, so a card paid down is green even though its
 * number is negative.
 */
function balanceColor(card: AccountCard): string {
  if (card.balanceChange > 0) return colors.income
  if (card.balanceChange < 0) return colors.expense
  return colors.textSecondary
}

interface HouseholdFlowChartProps {
  flow: HouseholdFlow
  sideMeta: (node: SideNode) => NodeMeta
  cardName: (card: AccountCard) => string
  /** The institution logo, or the fallback icon the Accounts screen uses for this account. */
  glyphFor: (card: AccountCard) => { logo: string | null; icon: { name: string; color: string } }
  isMasked: boolean
  onSidePress: (node: SideNode) => void
  onCardPress: (card: AccountCard) => void
  onRibbonPress: (ribbon: Ribbon) => void
  onLanePress: (lane: Lane) => void
}

/**
 * Income enters from the left and spending leaves to the right. Tapping an account card draws its
 * transfers to and from the user's other accounts as arrows beside the account column, fading the
 * other cards' ribbons; tapping it again clears them.
 *
 * Drawn at whatever size its content needs and shown through a zoomable viewport: pinch to zoom,
 * drag to pan. It opens fitted to the account column and its lanes, the part the user came to see;
 * the income and spending edges are a pan or a pinch away.
 */
export function HouseholdFlowChart({
  flow,
  sideMeta,
  cardName,
  glyphFor,
  isMasked,
  onSidePress,
  onCardPress,
  onRibbonPress,
  onLanePress,
}: HouseholdFlowChartProps) {
  // Cards widen to fit the longest name in full rather than truncating it — the chart pans and
  // zooms, so width is cheap and a cut-off account name is not.
  const cardWidth = useMemo(
    () =>
      Math.max(
        MIN_CARD_WIDTH,
        ...flow.cards.map((card) =>
          Math.max(
            CARD_TEXT_X + cardName(card).length * NAME_CHAR_WIDTH + CARD_TEXT_PADDING,
            10 + balanceLine(card, isMasked).length * BALANCE_CHAR_WIDTH + CARD_TEXT_PADDING,
          ),
        ),
      ),
    [flow.cards, cardName, isMasked],
  )
  // The card whose transfer arrows are showing. None by default: see layoutHousehold.
  const [activeCardId, setActiveCardId] = useState<string | null>(null)
  useEffect(() => setActiveCardId(null), [flow])
  // Each edge's label area is only as wide as its longest label. A fixed width left empty margins
  // the Fit zoom had to include, shrinking everything to make room for nothing.
  const labelWidthFor = useCallback(
    (nodes: SideNode[]) =>
      Math.min(
        MAX_LABEL_WIDTH,
        LABEL_GAP +
          4 +
          Math.max(
            0,
            ...nodes.map((node) => {
              const value = flow.ribbons.filter((r) => r.from === node.id || r.to === node.id).reduce((t, r) => t + r.amount, 0)
              return Math.max(
                truncate(sideMeta(node).label, LABEL_MAX_CHARS).length * LABEL_CHAR_WIDTH,
                formatCompactMaskableAmount(value, isMasked).length * AMOUNT_CHAR_WIDTH,
              )
            }),
          ),
      ),
    [flow.ribbons, sideMeta, isMasked],
  )
  const inLabelWidth = useMemo(() => labelWidthFor(flow.inNodes), [labelWidthFor, flow.inNodes])
  const outLabelWidth = useMemo(() => labelWidthFor(flow.outNodes), [labelWidthFor, flow.outNodes])
  const layout = useMemo(
    () => layoutHousehold(flow, { ...LAYOUT, cardWidth, inLabelWidth, outLabelWidth }, activeCardId),
    [flow, cardWidth, inLabelWidth, outLabelWidth, activeCardId],
  )
  const sideById = useMemo(() => new Map([...flow.inNodes, ...flow.outNodes].map((n) => [n.id, n])), [flow])
  const cardById = useMemo(() => new Map(flow.cards.map((c) => [c.id, c])), [flow.cards])
  const ribbonById = useMemo(() => new Map(flow.ribbons.map((r) => [r.id, r])), [flow.ribbons])
  const laneById = useMemo(() => new Map(flow.lanes.map((l) => [l.id, l])), [flow.lanes])

  const activeCard = activeCardId ? cardById.get(activeCardId) ?? null : null
  const outIds = useMemo(() => new Set(flow.outNodes.map((n) => n.id)), [flow.outNodes])

  const { height: windowHeight } = useWindowDimensions()
  const [viewWidth, setViewWidth] = useState(0)
  const viewHeight = Math.round(windowHeight * VIEWPORT_SCREEN_FRACTION)
  const content = useMemo(() => ({ width: layout.width, height: layout.height }), [layout.width, layout.height])
  const view = useMemo(() => ({ width: viewWidth, height: viewHeight }), [viewWidth, viewHeight])
  // The default view, and where the Fit button returns: the viewport's height filled, centered on
  // the account column, with the income and spending edges a sideways pan away. The chart is wider
  // than it is tall, so fitting all of it would waste most of a tall viewport.
  const accountsBox = useMemo(() => {
    const first = layout.cards[0]
    return first
      ? { x: first.x, y: 0, width: first.width, height: layout.height }
      : { x: 0, y: 0, width: layout.width, height: layout.height }
  }, [layout.cards, layout.width, layout.height])
  const initial = useMemo(
    () => (viewWidth > 0 ? fitTransform(accountsBox, content, view) : null),
    [accountsBox, content, view, viewWidth],
  )
  // Pinching out is still allowed down to the whole chart.
  const wholeChart = useMemo(
    () => (viewWidth > 0 ? fitTransform({ x: 0, y: 0, ...content }, content, view) : null),
    [content, view, viewWidth],
  )

  const scale = useSharedValue(1)
  const x = useSharedValue(0)
  const y = useSharedValue(0)
  const start = useSharedValue({ scale: 1, x: 0, y: 0, focalX: 0, focalY: 0 })

  // Re-fit whenever the data changes (another month, a recategorization), not just on mount.
  // Keyed on the fit's numbers rather than the layout: selecting a card redraws the layout but
  // moves nothing, and must not throw away the user's zoom.
  useEffect(() => {
    if (!initial) return
    scale.value = initial.scale
    x.value = initial.x
    y.value = initial.y
  }, [initial?.scale, initial?.x, initial?.y, scale, x, y])

  // Pinching out can go at least as far as the fitted view, so the two never disagree.
  const lowest = wholeChart ? minScale(content, view, wholeChart.scale) : 1
  function resetZoom() {
    if (!initial) return
    scale.value = withTiming(initial.scale)
    x.value = withTiming(initial.x)
    y.value = withTiming(initial.y)
  }

  const gesture = useMemo(() => {
    const pinch = Gesture.Pinch()
      .onStart((e) => {
        start.value = { scale: scale.value, x: x.value, y: y.value, focalX: e.focalX, focalY: e.focalY }
      })
      .onUpdate((e) => {
        const s = Math.min(MAX_SCALE, Math.max(lowest, start.value.scale * e.scale))
        const ratio = s / start.value.scale
        // Zoom about the pinch's focal point, and let the focal point's drift pan at the same time.
        scale.value = s
        x.value = clampOffset(e.focalX - (start.value.focalX - start.value.x) * ratio, s, content.width, view.width)
        y.value = clampOffset(e.focalY - (start.value.focalY - start.value.y) * ratio, s, content.height, view.height)
      })
    const pan = Gesture.Pan()
      // Past a tap's wobble, so tapping a ribbon or card still opens it.
      .minDistance(8)
      .averageTouches(true)
      .onStart(() => {
        start.value = { ...start.value, x: x.value, y: y.value }
      })
      .onUpdate((e) => {
        x.value = clampOffset(start.value.x + e.translationX, scale.value, content.width, view.width)
        y.value = clampOffset(start.value.y + e.translationY, scale.value, content.height, view.height)
      })
    return Gesture.Simultaneous(pinch, pan)
  }, [lowest, content, view, scale, x, y, start])

  const contentStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: x.value }, { translateY: y.value }, { scale: scale.value }],
  }))

  return (
    <View
      onLayout={(e) => setViewWidth(e.nativeEvent.layout.width)}
      style={{ height: viewHeight, overflow: 'hidden', borderRadius: 8, backgroundColor: colors.surface }}
    >
      <GestureDetector gesture={gesture}>
      <View style={{ flex: 1 }}>
      <Animated.View style={[{ width: layout.width, height: layout.height, transformOrigin: 'top left' }, contentStyle]}>
      <Svg width={layout.width} height={layout.height}>
        {/* Ribbons first, so lanes and cards draw over them. */}
        {layout.ribbons.map((placed) => {
          const ribbon = ribbonById.get(placed.id)!
          const outside = sideById.get(sideById.has(ribbon.from) ? ribbon.from : ribbon.to)
          const color = ribbonColor(ribbon, outside ? sideMeta(outside) : { label: '', color: colors.textMuted })
          // With a card selected, every other card's ribbons fade so its arrows read cleanly over them.
          const faded = activeCardId != null && ribbon.from !== activeCardId && ribbon.to !== activeCardId
          return (
            <Path key={placed.id} d={placed.path} fill={color} fillOpacity={faded ? 0.06 : 0.3} onPress={() => onRibbonPress(ribbon)} />
          )
        })}

        {layout.lanes.map((placed) => {
          const lane = laneById.get(placed.id)!
          const color = laneColor(lane)
          return (
            <G key={placed.id} onPress={() => onLanePress(lane)}>
              {/* A halo under each lane: where a ribbon passes beneath, it reads as a bridge, not a tangle. */}
              <Path d={placed.path} stroke={colors.surface} strokeWidth={placed.thickness + 4} fill="none" strokeLinecap="round" />
              <Path d={placed.path} stroke={color} strokeWidth={placed.thickness} fill="none" strokeLinecap="round" />
              <Path d={placed.arrow} fill={color} />
              {/* A generous invisible target: a 2px line is too thin to tap. */}
              <Path d={placed.path} stroke="transparent" strokeWidth={18} fill="none" />
            </G>
          )
        })}

        {layout.lanes.map((placed) => {
          const lane = laneById.get(placed.id)!
          const text = isMasked ? MASKED_AMOUNT : laneAmountText(lane.amount)
          const width = pillWidth(text)
          const color = laneColor(lane)
          return (
            <G key={`pill:${placed.id}`} onPress={() => onLanePress(lane)}>
              <Rect x={placed.labelX - width / 2} y={placed.labelY - 8} width={width} height={16} rx={8} fill={colors.surface} stroke={color} strokeWidth={1} />
              <SvgText x={placed.labelX} y={placed.labelY + 3.5} fontSize={10} fontFamily={fontFamily.mono} fill={color} textAnchor="middle">
                {text}
              </SvgText>
            </G>
          )
        })}

        {layout.cards.map((placed) => {
          const card = cardById.get(placed.id)!
          const color = roleColors[card.role as AccountRole]
          return (
            <G key={placed.id} onPress={() => setActiveCardId((current) => (current === card.id ? null : card.id))}>
              <Rect x={placed.x} y={placed.y} width={placed.width} height={placed.height} rx={8} fill={colors.surface} />
              <Rect
                x={placed.x}
                y={placed.y}
                width={placed.width}
                height={placed.height}
                rx={8}
                fill={hexToRgba(color, card.id === activeCardId ? 0.22 : 0.1)}
                stroke={color}
                strokeWidth={card.id === activeCardId ? 3 : 1.5}
              />
              <SvgText x={placed.x + CARD_TEXT_X} y={placed.y + 23} fontSize={12} fontFamily={fontFamily.sansSemi} fill={colors.textPrimary}>
                {cardName(card)}
              </SvgText>
              <SvgText x={placed.x + 10} y={placed.y + 44} fontSize={11} fontFamily={fontFamily.mono} fill={balanceColor(card)}>
                {balanceLine(card, isMasked)}
              </SvgText>
            </G>
          )
        })}

        {[...layout.inNodes, ...layout.outNodes].map((placed) => {
          const node = sideById.get(placed.id)!
          const meta = sideMeta(node)
          const isOut = outIds.has(placed.id)
          const labelX = isOut ? placed.x + BAR_WIDTH + LABEL_GAP : placed.x - LABEL_GAP
          const anchor = isOut ? 'start' : 'end'
          const midY = placed.slotY + placed.slotHeight / 2
          return (
            <G key={placed.id} onPress={() => onSidePress(node)}>
              <Rect x={placed.x} y={placed.y} width={BAR_WIDTH} height={placed.height} rx={2} fill={meta.color} />
              <Rect
                x={isOut ? placed.x : placed.x - inLabelWidth}
                y={placed.slotY}
                width={(isOut ? outLabelWidth : inLabelWidth) + BAR_WIDTH}
                height={placed.slotHeight}
                fill="transparent"
              />
              <SvgText x={labelX} y={midY - 2} fontSize={11} fontFamily={fontFamily.sansSemi} fill={colors.textPrimary} textAnchor={anchor}>
                {truncate(meta.label, LABEL_MAX_CHARS)}
              </SvgText>
              <SvgText x={labelX} y={midY + 11} fontSize={10} fontFamily={fontFamily.mono} fill={colors.textSecondary} textAnchor={anchor}>
                {formatCompactMaskableAmount(placed.value, isMasked)}
              </SvgText>
            </G>
          )
        })}
      </Svg>
      {/* Logos are RN Images laid over the SVG rather than SVG images, so they reuse AccountGlyph
          and look exactly as they do on the Accounts screen. Touches pass through to the card. */}
      {layout.cards.map((placed) => {
        const glyph = glyphFor(cardById.get(placed.id)!)
        return (
          <View key={`glyph:${placed.id}`} pointerEvents="none" style={{ position: 'absolute', left: placed.x + 10, top: placed.y + 10 }}>
            <AccountGlyph logo={glyph.logo} icon={glyph.icon} size={GLYPH_SIZE} />
          </View>
        )
      })}
      </Animated.View>
      </View>
      </GestureDetector>
      {/* One row, so the transactions button can only shrink into the space Fit leaves it. */}
      <View pointerEvents="box-none" className="absolute flex-row items-center gap-2" style={{ left: 8, right: 8, top: 8 }}>
        {activeCard ? (
          <Pressable
            onPress={() => onCardPress(activeCard)}
            hitSlop={8}
            className="flex-row items-center gap-1 rounded-full px-2.5 py-1"
            style={{ flexShrink: 1, backgroundColor: colors.textPrimary }}
          >
            <Text className="font-sansMed text-xs" style={{ flexShrink: 1, color: colors.textInverse }} numberOfLines={1}>
              View {cardName(activeCard)} transactions
            </Text>
            <Ionicons name="chevron-forward" size={12} color={colors.textInverse} />
          </Pressable>
        ) : null}
        <View style={{ flex: 1 }} pointerEvents="none" />
        <Pressable
          onPress={resetZoom}
          hitSlop={8}
          accessibilityLabel="Reset zoom"
          className="flex-row items-center gap-1 rounded-full px-2.5 py-1"
          style={{ flexShrink: 0, backgroundColor: colors.surfaceRaised }}
        >
          <Ionicons name="scan-outline" size={13} color={colors.textSecondary} />
          <Text className="font-sansMed text-xs text-textSecondary">Fit</Text>
        </Pressable>
      </View>
    </View>
  )
}
