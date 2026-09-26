import { useEffect, useMemo, useState } from 'react'
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

const LABEL_WIDTH = 150
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

/** The viewport's share of the screen height. */
const VIEWPORT_SCREEN_FRACTION = 0.6

const LAYOUT = {
  labelWidth: LABEL_WIDTH,
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

function balanceLine(card: AccountCard, isMasked: boolean): string {
  const signed = (v: number) => `${v > 0 ? '+' : v < 0 ? '−' : ''}${formatMaskableAmount(Math.abs(v), isMasked)}`
  // A card's value rises as debt falls, so flip it into "owed" terms, the way the issuer shows it.
  return card.role === 'debt' ? `Owed ${signed(-card.balanceChange)}` : signed(card.balanceChange)
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
 * Income enters from the left, spending leaves to the right, and transfers between the user's own
 * accounts are arrows in the lanes beside the account column.
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
  const layout = useMemo(() => layoutHousehold(flow, { ...LAYOUT, cardWidth }), [flow, cardWidth])
  const sideById = useMemo(() => new Map([...flow.inNodes, ...flow.outNodes].map((n) => [n.id, n])), [flow])
  const cardById = useMemo(() => new Map(flow.cards.map((c) => [c.id, c])), [flow.cards])
  const ribbonById = useMemo(() => new Map(flow.ribbons.map((r) => [r.id, r])), [flow.ribbons])
  const laneById = useMemo(() => new Map(flow.lanes.map((l) => [l.id, l])), [flow.lanes])

  const outIds = useMemo(() => new Set(flow.outNodes.map((n) => n.id)), [flow.outNodes])

  const { height: windowHeight } = useWindowDimensions()
  const viewHeight = Math.round(windowHeight * VIEWPORT_SCREEN_FRACTION)
  const [viewWidth, setViewWidth] = useState(0)
  const content = useMemo(() => ({ width: layout.width, height: layout.height }), [layout.width, layout.height])
  const view = useMemo(() => ({ width: viewWidth, height: viewHeight }), [viewWidth, viewHeight])
  const fit = useMemo(() => (viewWidth > 0 ? fitTransform(layout.focus, content, view) : null), [layout.focus, content, view, viewWidth])
  const lowest = fit ? minScale(content, view, fit.scale) : 1

  const scale = useSharedValue(1)
  const x = useSharedValue(0)
  const y = useSharedValue(0)
  const start = useSharedValue({ scale: 1, x: 0, y: 0, focalX: 0, focalY: 0 })

  // Re-fit whenever what's drawn changes (another month, a recategorization), not just on mount.
  useEffect(() => {
    if (!fit) return
    scale.value = fit.scale
    x.value = fit.x
    y.value = fit.y
  }, [fit, scale, x, y])

  function resetZoom() {
    if (!fit) return
    scale.value = withTiming(fit.scale)
    x.value = withTiming(fit.x)
    y.value = withTiming(fit.y)
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
          return <Path key={placed.id} d={placed.path} fill={color} fillOpacity={0.3} onPress={() => onRibbonPress(ribbon)} />
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
            <G key={placed.id} onPress={() => onCardPress(card)}>
              <Rect x={placed.x} y={placed.y} width={placed.width} height={placed.height} rx={8} fill={colors.surface} />
              <Rect x={placed.x} y={placed.y} width={placed.width} height={placed.height} rx={8} fill={hexToRgba(color, 0.1)} stroke={color} strokeWidth={1.5} />
              <SvgText x={placed.x + CARD_TEXT_X} y={placed.y + 23} fontSize={12} fontFamily={fontFamily.sansSemi} fill={colors.textPrimary}>
                {cardName(card)}
              </SvgText>
              <SvgText x={placed.x + 10} y={placed.y + 44} fontSize={11} fontFamily={fontFamily.mono} fill={colors.textSecondary}>
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
              <Rect x={isOut ? placed.x : placed.x - LABEL_WIDTH} y={placed.slotY} width={LABEL_WIDTH + BAR_WIDTH} height={placed.slotHeight} fill="transparent" />
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
      <Pressable
        onPress={resetZoom}
        hitSlop={8}
        accessibilityLabel="Fit to accounts"
        className="absolute flex-row items-center gap-1 rounded-full px-2.5 py-1"
        style={{ right: 8, top: 8, backgroundColor: colors.surfaceRaised }}
      >
        <Ionicons name="scan-outline" size={13} color={colors.textSecondary} />
        <Text className="font-sansMed text-xs text-textSecondary">Fit</Text>
      </Pressable>
    </View>
  )
}
