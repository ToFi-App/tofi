import { Text, View } from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import { blendOver, colors, heroGradient } from '@/constants/theme'
import type { ComponentProps } from 'react'
import { MASKED_AMOUNT, formatAmount, formatMaskableAmount } from '@/lib/format/money'
import { useAmountsMasked } from '@/hooks/useAmountsMasked'
import { MaskToggle } from '@/components/ui/MaskToggle'

/** Inter's tabular figures: digits all one width, so amounts line up without a monospace face. */
const TABULAR = { fontVariant: ['tabular-nums' as const] }
/** Ink on Home's mint top section: white or near-black, whichever passes contrast there (readableInk). */
export const HERO_INK = heroGradient.ink
/** In and out arrows: the deep green and red sink into a dark top section, so on one they're lifted
 *  toward white and stay legible as the same green and red. */
const IS_DARK_HERO = heroGradient.ink === colors.textInverse
const INCOME_ARROW = IS_DARK_HERO ? blendOver(colors.income, 0.55, colors.textInverse) : colors.income
const EXPENSE_ARROW = IS_DARK_HERO ? blendOver(colors.expense, 0.55, colors.textInverse) : colors.expense
/** The In/Out pills' look: a faint veil either way — on a pale top section a mostly-white one with no
 *  shadow, quieter than the header's white chips, so the pills stay a footnote to the net above. */
const PILL_LOOK = IS_DARK_HERO ? { backgroundColor: colors.glassQuiet } : { backgroundColor: 'rgba(255,255,255,0.75)' }

/** Plus or minus in front; zero goes unsigned, since it's neither money in nor out. */
export function signedAmount(amount: number): string {
  if (Math.abs(amount) < 0.005) return formatAmount(0)
  return `${amount < 0 ? '−' : '+'}${formatAmount(Math.abs(amount))}`
}

interface MonthHeadlineProps {
  totalExpense: number
  totalIncome: number
}

/**
 * The month's one figure, centred on Home's top section: what it's for, the net, and under it the two
 * halves it's made of — money in and money out — as a pair of pills. The budget and the spending
 * chart sit on the sheet below.
 *
 * The net carries its sign rather than red or green: the sign already says which way the month went.
 * The pills' arrows carry the colour instead, green in and red out.
 */
export function MonthHeadline({ totalExpense, totalIncome }: MonthHeadlineProps) {
  const { isMasked } = useAmountsMasked()
  const net = totalIncome - totalExpense

  return (
    <View className="items-center gap-2.5">
      <Text className="font-sansSemi text-sm" style={{ color: HERO_INK }}>
        Net this month
      </Text>

      {/* The figure and its eye are one tap target, as on Net Worth, centred together as one group —
          the figure sits a little left of centre, so the eye's weight on the right balances out. */}
      <View className="flex-row items-center">
        <MaskToggle size={EYE_SIZE} color={HERO_INK}>
          <Text
            className="shrink font-display text-3xl"
            style={[TABULAR, { color: HERO_INK, letterSpacing: -0.8 }]}
            numberOfLines={1}
            adjustsFontSizeToFit
          >
            {isMasked ? MASKED_AMOUNT : signedAmount(net)}
          </Text>
        </MaskToggle>
      </View>

      {/* In and out side by side, read together as the two halves of the net above. */}
      <View className="mt-1.5 flex-row gap-2">
        <FlowPill icon="arrow-down" iconColor={INCOME_ARROW} label="In" amount={formatMaskableAmount(totalIncome, isMasked)} />
        <FlowPill icon="arrow-up" iconColor={EXPENSE_ARROW} label="Out" amount={formatMaskableAmount(totalExpense, isMasked)} />
      </View>
    </View>
  )
}

/** The eye beside the figure. */
const EYE_SIZE = 20

/**
 * One half of the net — an arrow in its direction's colour, the word, the amount. Information, not a
 * control, so no Liquid Glass (Apple keeps that to controls and navigation): a faint white veil over
 * the mint, quieter than the header's controls so the net above stays the focus.
 */
function FlowPill({
  icon,
  iconColor,
  label,
  amount,
}: {
  icon: ComponentProps<typeof Ionicons>['name']
  iconColor: string
  label: string
  amount: string
}) {
  return (
    <View
      style={{
        height: 30,
        borderRadius: 15,
        paddingHorizontal: 12,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
        ...PILL_LOOK,
      }}
    >
      <Ionicons name={icon} size={13} color={iconColor} />
      <Text className="font-sansMed text-sm" style={{ color: HERO_INK }}>
        {label}
      </Text>
      <Text className="font-sansMed text-sm" style={[TABULAR, { color: HERO_INK }]} numberOfLines={1}>
        {amount}
      </Text>
    </View>
  )
}
