import { useEffect, useState } from 'react'
import { Pressable, Text, View } from 'react-native'
import Animated, { Easing, useAnimatedProps, useReducedMotion, useSharedValue, withTiming } from 'react-native-reanimated'
import Svg, { Circle, Path } from 'react-native-svg'
import { colors, hexToRgba } from '@/constants/theme'
import { savingsChange, savingsRate } from '@/lib/home/savingsRate'
import { MASKED_AMOUNT } from '@/lib/format/money'
import { useAmountsMasked } from '@/hooks/useAmountsMasked'
import { Card } from '@/components/ui/Card'
import { TileIcon } from '@/components/ui/TileIcon'

const AnimatedCircle = Animated.createAnimatedComponent(Circle)
const AnimatedPath = Animated.createAnimatedComponent(Path)

/** Inter's tabular figures: digits all one width, so amounts line up without a monospace face. */
const TABULAR = { fontVariant: ['tabular-nums' as const] }
/** The ring, sized to sit under the title level with the Spending chart beside it. */
const RING_SIZE = 92
const RING_STROKE = 10
const RING_RADIUS = (RING_SIZE - RING_STROKE) / 2
/** The knob riding the end of the fill, as on the Budget arc. */
const KNOB_RADIUS = 5
/** How long the ring takes to fill when it appears or the rate changes. */
const FILL_MS = 900
/** Room inside the ring for the figures, so a long one shrinks rather than running over it. */
const FIGURE_WIDTH = RING_SIZE - RING_STROKE * 2 - 10
/** How long a press is held before the comparison shows — long enough that a scroll passing over the
 *  tile doesn't flash it. */
const REVEAL_DELAY_MS = 250

/** A rate as a whole percent, with a true minus sign when it's negative. */
function percent(rate: number): string {
  const rounded = Math.round(rate * 100)
  return rounded < 0 ? `−${-rounded}%` : `${rounded}%`
}

/**
 * The month's savings rate, as a tile beside Spending on Home: how much of what came in wasn't spent,
 * over the same In and Out totals as the top section's pills. A ring — the same language as the
 * category tiles' rings — with the rate in a soft well of its colour in the middle:
 *
 * - kept something: green, filling clockwise toward 100% of income kept;
 * - spent more than came in: rose, filling the other way toward −100% — spending twice what came in.
 *
 * The ring fills in as it appears, with a white-ringed knob riding its end; past ±100% it's simply
 * full. At rest it shows the rate alone — the top section already shows what came in and the net.
 * Touching and holding it puts last month in the ring's place, as one sentence — "Saved $120 less than
 * last month", or "Overspent $1,500 more than last month" when both months spent more than came in
 * (savingsChange) — green when it's better, red when worse. Letting go puts the ring back, as the Spending chart beside it reads a day only
 * while touched.
 */
export function SavingsRate({
  income,
  expense,
  previous,
}: {
  income: number
  expense: number
  /** Last month's In and Out. */
  previous: { income: number; expense: number }
}) {
  const rate = savingsRate(income, expense)
  const isNegative = rate != null && rate < 0
  const rateColor = rate == null ? colors.textSecondary : isNegative ? colors.expense : colors.income
  const filled = rate == null ? 0 : Math.min(1, Math.abs(rate))
  const centre = RING_SIZE / 2

  const [isRevealed, setIsRevealed] = useState(false)
  // Against last month (savingsChange): what each saved, a month that overspent counting as $0, or
  // the overspending when both did. Last month's whole month, so mid-month it's this month so far
  // against all of last.
  const { isMasked } = useAmountsMasked()
  const versus = savingsChange({ income, expense }, previous)
  const change = versus?.change ?? null
  const verb = versus?.kind === 'overspent' ? 'Overspent' : 'Saved'
  // Better is green: more saved, or less overspent.
  const isBetter = change != null && (versus?.kind === 'overspent' ? change < 0 : change > 0)
  const changeColor = change == null || change === 0 ? colors.textPrimary : isBetter ? colors.income : colors.expense
  const changeAmount = change == null ? '' : isMasked ? MASKED_AMOUNT : `$${Math.abs(change).toLocaleString('en-US')}`
  const comparison =
    change == null
      ? 'Nothing last month to compare with'
      : change === 0
        ? `${verb} the same as last month`
        : `${verb} ${changeAmount} ${change < 0 ? 'less' : 'more'} than last month`

  const reduceMotion = useReducedMotion()
  const progress = useSharedValue(reduceMotion ? filled : 0)
  useEffect(() => {
    progress.value = reduceMotion ? filled : withTiming(filled, { duration: FILL_MS, easing: Easing.out(Easing.cubic) })
  }, [filled, reduceMotion, progress])

  // The fill as an arc from the top round to the rate, redrawn each frame — the same sum that places
  // the knob, so the two never part. (Animating a circle's dash lengths instead lagged behind the
  // knob on iOS.) A full ring is two half circles: one arc can't end where it started.
  const fillProps = useAnimatedProps(() => {
    const p = Math.min(1, Math.max(0, progress.value))
    const top = `M ${centre} ${centre - RING_RADIUS}`
    if (p <= 0.002) return { d: top }
    if (p >= 0.999) {
      return {
        d: `${top} A ${RING_RADIUS} ${RING_RADIUS} 0 1 1 ${centre} ${centre + RING_RADIUS} A ${RING_RADIUS} ${RING_RADIUS} 0 1 1 ${centre} ${centre - RING_RADIUS}`,
      }
    }
    const angle = 2 * Math.PI * p
    const x = centre + RING_RADIUS * Math.sin(angle)
    const y = centre - RING_RADIUS * Math.cos(angle)
    return { d: `${top} A ${RING_RADIUS} ${RING_RADIUS} 0 ${p > 0.5 ? 1 : 0} 1 ${x} ${y}` }
  })
  // The knob, from the top round the ring as far as the fill has got. Hidden on a full ring, where
  // there's no end for it to mark.
  const knobProps = useAnimatedProps(() => {
    const angle = 2 * Math.PI * progress.value
    return {
      cx: centre + RING_RADIUS * Math.sin(angle),
      cy: centre - RING_RADIUS * Math.cos(angle),
      opacity: progress.value > 0.002 && progress.value < 0.995 ? 1 : 0,
    }
  })

  return (
    // Held, not tapped: the tile has nowhere to go, and a hold reads the same as touching the chart
    // beside it. VoiceOver hears the comparison in the label instead.
    <Pressable
      style={{ flex: 1 }}
      delayLongPress={REVEAL_DELAY_MS}
      onLongPress={() => {
        if (rate != null) setIsRevealed(true)
      }}
      onPressOut={() => setIsRevealed(false)}
      accessibilityLabel={
        rate == null ? 'Savings rate. No income yet this month' : `Savings rate ${percent(rate)} of income. ${comparison}`
      }
    >
      <Card grow style={{ padding: 14, gap: 8 }}>
        <View className="flex-row items-center gap-2">
          <TileIcon name="leaf" color={rateColor} />
          <Text className="shrink font-sansSemi text-base text-textPrimary" numberOfLines={1}>
            Savings rate
          </Text>
        </View>

        <View className="flex-1 items-center justify-center">
          {/* Held: last month in the ring's place, the ring kept laid out underneath so nothing moves. */}
          {isRevealed ? (
            <View className="absolute inset-0 items-center justify-center px-1" pointerEvents="none">
              <Text className="text-center font-sansMed text-sm text-textPrimary" style={TABULAR}>
                {change == null || change === 0 ? (
                  comparison
                ) : (
                  <>
                    {verb}{' '}
                    <Text className="font-display text-lg" style={{ color: changeColor }}>
                      {changeAmount}
                    </Text>{' '}
                    {change < 0 ? 'less' : 'more'} than last month
                  </>
                )}
              </Text>
            </View>
          ) : null}
          <View style={{ width: RING_SIZE, height: RING_SIZE, opacity: isRevealed ? 0 : 1 }}>
            {/* Mirrored for a negative rate, so it fills anticlockwise from the top. */}
            <Svg width={RING_SIZE} height={RING_SIZE} style={isNegative ? { transform: [{ scaleX: -1 }] } : undefined}>
              {/* A soft well of the rate's colour inside, and the track tinted to match. */}
              <Circle cx={centre} cy={centre} r={RING_RADIUS - RING_STROKE / 2} fill={hexToRgba(rateColor, 0.07)} />
              <Circle
                cx={centre}
                cy={centre}
                r={RING_RADIUS}
                stroke={hexToRgba(rateColor, 0.14)}
                strokeWidth={RING_STROKE}
                fill="none"
              />
              <AnimatedPath
                animatedProps={fillProps}
                stroke={rateColor}
                strokeWidth={RING_STROKE}
                strokeLinecap="round"
                fill="none"
              />
              <AnimatedCircle
                animatedProps={knobProps}
                r={KNOB_RADIUS}
                fill={rateColor}
                stroke={colors.surface}
                strokeWidth={2.5}
              />
            </Svg>
            <View className="absolute inset-0 items-center justify-center" pointerEvents="none">
              {rate == null ? (
                // With nothing in yet there's no rate to show, and a bare dash wouldn't say why.
                <Text className="text-center font-sansMed text-xs text-textPrimary">No income{'\n'}yet</Text>
              ) : (
                <Text
                  className="text-center font-display text-lg"
                  style={[TABULAR, { color: rateColor, maxWidth: FIGURE_WIDTH }]}
                  numberOfLines={1}
                  adjustsFontSizeToFit
                  minimumFontScale={0.5}
                >
                  {percent(rate)}
                </Text>
              )}
            </View>
          </View>
        </View>
      </Card>
    </Pressable>
  )
}
