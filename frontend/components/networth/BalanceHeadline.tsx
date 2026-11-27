import type { ReactNode } from 'react'
import { Text, View } from 'react-native'
import { colors } from '@/constants/theme'
import { MaskToggle } from '@/components/ui/MaskToggle'
import { ChangeLabel } from '@/components/networth/ChangeLabel'
import { formatGainPct } from '@/lib/accounts/holdings'
import { formatAmount, formatMaskableAmount } from '@/lib/format/money'

interface BalanceHeadlineProps {
  /** What the figure is: "Your net worth", "Your portfolio". The eye beside it hides every amount. */
  label: string
  value: number
  /** Balances are still loading: a placeholder bar stands in for the figure. */
  isLoading?: boolean
  /** The change over the chart's window, and as a share of where the window opened; none hides the line. */
  change: { amount: number; pct: number | null } | null
  /** What the change is measured over: "Past month", or the day being read off the chart. */
  caption?: string
  isMasked: boolean
  /** Shown at the end of the change line: the ⓘ for how current the figures are. */
  info?: ReactNode
}

/**
 * The top of each Net Worth view: a label with the eye, the figure large under it, and how it moved
 * over the chart's window in gain green or loss red. Hidden, only the percentage stays: direction
 * without magnitude.
 */
export function BalanceHeadline({ label, value, isLoading, change, caption, isMasked, info }: BalanceHeadlineProps) {
  return (
    <View className="gap-1.5 px-5">
      <View className="flex-row">
        <MaskToggle size={16} color={colors.textSecondary}>
          <Text className="font-sans text-sm text-textSecondary">{label}</Text>
        </MaskToggle>
      </View>
      {isLoading ? (
        <View className="h-10 w-44 rounded-md bg-surfaceRaised" />
      ) : (
        <Text
          className="font-display text-2xl text-textPrimary"
          style={{ letterSpacing: -0.6, fontVariant: ['tabular-nums'] }}
          numberOfLines={1}
          adjustsFontSizeToFit
        >
          {formatMaskableAmount(value, isMasked)}
        </Text>
      )}
      {change || info ? (
        <View className="flex-row items-center gap-1.5">
          {change ? (
            <ChangeLabel
              change={change.amount}
              text={
                isMasked
                  ? formatGainPct(change.pct)
                  : `${formatAmount(Math.abs(change.amount))}${change.pct != null ? ` (${formatGainPct(change.pct)})` : ''}`
              }
            />
          ) : null}
          {caption ? <Text className="font-sans text-sm text-textSecondary">{caption}</Text> : null}
          {info}
        </View>
      ) : null}
    </View>
  )
}
