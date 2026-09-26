import { Text, View } from 'react-native'
import { colors, flowColors, shadow } from '@/constants/theme'
import { formatMaskableAmount } from '@/lib/format/money'
import type { CashFlowHeadline as Headline } from '@/lib/cashflow/buildFlowGraph'

function signed(amount: number, isMasked: boolean): string {
  return `${amount > 0 ? '+' : ''}${formatMaskableAmount(amount, isMasked)}`
}

function Chip({ label, amount, color, isMasked }: { label: string; amount: number; color: string; isMasked: boolean }) {
  return (
    <View className="flex-row items-center gap-2 rounded-md bg-surfaceRaised px-3 py-2" style={{ width: '48%' }}>
      <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: color }} />
      <View className="flex-1">
        <Text className="font-sans text-xs text-textSecondary">{label}</Text>
        <Text className="font-mono text-sm text-textPrimary">{signed(amount, isMasked)}</Text>
      </View>
    </View>
  )
}

/**
 * The month's answer in one number, with its parts beside it. The parts are shown as a sum on
 * purpose: they add up to the net exactly (see buildFlowGraph), and seeing that is what lets the
 * user trust the number rather than take it on faith.
 */
export function CashFlowHeadline({ headline, isMasked }: { headline: Headline; isMasked: boolean }) {
  const netColor = headline.net >= 0 ? colors.income : colors.expense
  const rate = headline.savingsRate
  const debtLabel = headline.debtPaid < 0 ? 'Debt added' : 'Debt paid down'

  return (
    <View className="gap-3 rounded-md bg-surface p-4" style={shadow.sm}>
      <View className="items-center gap-1">
        <Text className="font-sans text-sm text-textSecondary">Net cash flow</Text>
        <Text className="font-display text-xl" style={{ color: netColor }}>
          {signed(headline.net, isMasked)}
        </Text>
        <Text className="font-sans text-sm text-textSecondary">
          {rate == null ? 'No income this month' : `Savings rate ${Math.round(rate * 100)}%`}
        </Text>
      </View>

      <View className="flex-row justify-between">
        <Text className="font-sans text-sm text-textSecondary">
          Income <Text className="font-mono" style={{ color: colors.income }}>{formatMaskableAmount(headline.income, isMasked)}</Text>
        </Text>
        <Text className="font-sans text-sm text-textSecondary">
          Spending <Text className="font-mono" style={{ color: colors.expense }}>{formatMaskableAmount(headline.spending, isMasked)}</Text>
        </Text>
      </View>

      <View className="flex-row flex-wrap justify-between" style={{ rowGap: 8 }}>
        <Chip label="Saved" amount={headline.saved} color={flowColors.saved} isMasked={isMasked} />
        <Chip label="Invested" amount={headline.invested} color={flowColors.invested} isMasked={isMasked} />
        <Chip label={debtLabel} amount={headline.debtPaid} color={flowColors.debtPaid} isMasked={isMasked} />
        <Chip label="Checking & cash" amount={headline.checkingChange} color={colors.transfer} isMasked={isMasked} />
        {headline.unlinked !== 0 ? (
          <Chip label="To unlinked accounts" amount={headline.unlinked} color={flowColors.unlinked} isMasked={isMasked} />
        ) : null}
        {headline.reimbursements !== 0 ? (
          <Chip label="Reimbursements" amount={headline.reimbursements} color={colors.reimbursed} isMasked={isMasked} />
        ) : null}
      </View>
    </View>
  )
}
