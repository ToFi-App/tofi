import type { ComponentProps } from 'react'
import { Text, View } from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import { blendOver, colors, hexToRgba } from '@/constants/theme'
import { MASKED_AMOUNT, formatAmount, formatMaskableAmount } from '@/lib/format/money'
import { useAmountsMasked } from '@/hooks/useAmountsMasked'
import { MaskToggle } from '@/components/ui/MaskToggle'

/** Inter's tabular figures: digits all one width, so amounts line up without a monospace face. */
const TABULAR = { fontVariant: ['tabular-nums' as const] }
/** Secondary type on the teal: white, softened, so the net stays the loudest thing on it. */
export const ON_PRIMARY_SOFT = hexToRgba(colors.textInverse, 0.72)
/** The in and out colours lifted toward white: the deep shades are tuned for light surfaces and sink
 *  into the dark teal chips, where these stay legible as the same green and red. */
const INCOME_ON_PRIMARY = blendOver(colors.income, 0.55, colors.textInverse)
const EXPENSE_ON_PRIMARY = blendOver(colors.expense, 0.55, colors.textInverse)

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
 * The month's figures, on Home's teal top section: the net, large, with the money in and out as a
 * pair of chips under it. Only the figures — Cash Flow and how the month is pacing (budget, against
 * last month) sit on the sheet below, beside the categories.
 *
 * Everything here is white on the brand colour. The net carries its sign rather than red or green:
 * those fail contrast on teal, and the sign already says which way the month went. The chips' arrows
 * say in and out the same way.
 */
export function MonthHeadline({ totalExpense, totalIncome }: MonthHeadlineProps) {
  const { isMasked } = useAmountsMasked()
  const net = totalIncome - totalExpense

  return (
    <View className="gap-3">
      {/* The figure and its eye are one tap target, as on Net Worth and Investments. */}
      <View className="flex-row">
        <MaskToggle color={ON_PRIMARY_SOFT}>
          <Text className="shrink font-display text-2xl" style={{ color: colors.textInverse }} numberOfLines={1} adjustsFontSizeToFit>
            {isMasked ? MASKED_AMOUNT : signedAmount(net)}
          </Text>
        </MaskToggle>
      </View>

      {/* In and out side by side, read together as the two halves of the net above. */}
      <View className="flex-row gap-2">
        <FlowChip icon="arrow-down" iconColor={INCOME_ON_PRIMARY} label="In" amount={formatMaskableAmount(totalIncome, isMasked)} />
        <FlowChip icon="arrow-up" iconColor={EXPENSE_ON_PRIMARY} label="Out" amount={formatMaskableAmount(totalExpense, isMasked)} />
      </View>
    </View>
  )
}

function FlowChip({
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
    <View className="flex-row items-center gap-1.5 rounded-xl px-3 py-1.5" style={{ backgroundColor: colors.primaryDim }}>
      <Ionicons name={icon} size={13} color={iconColor} />
      <Text className="font-sans text-sm" style={{ color: ON_PRIMARY_SOFT }}>
        {label}
      </Text>
      <Text className="font-sansSemi text-sm" style={[TABULAR, { color: colors.textInverse }]}>
        {amount}
      </Text>
    </View>
  )
}
