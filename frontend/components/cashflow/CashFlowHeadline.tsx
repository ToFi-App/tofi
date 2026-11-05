import type { ComponentProps } from 'react'
import { Text, View } from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import { colors, flowColors, hexToRgba, shadow } from '@/constants/theme'
import { formatMaskableAmount } from '@/lib/format/money'
import type { CashFlowHeadline as Headline } from '@/lib/cashflow/buildFlowGraph'

/** Inter's tabular figures: digits all one width, so amounts line up without a monospace face. */
const TABULAR = { fontVariant: ['tabular-nums' as const] }

type IconName = ComponentProps<typeof Ionicons>['name']

function signed(amount: number, isMasked: boolean): string {
  return `${amount > 0 ? '+' : ''}${formatMaskableAmount(amount, isMasked)}`
}

/** Money in or out, as Home's summary shows it: an arrow in its colour, the word, the amount. */
function FlowChip({ icon, iconColor, label, amount }: { icon: IconName; iconColor: string; label: string; amount: string }) {
  return (
    <View className="flex-row items-center gap-1.5 rounded-xl bg-surfaceRaised px-3 py-1.5">
      <Ionicons name={icon} size={13} color={iconColor} />
      <Text className="font-sansMed text-sm text-textPrimary">{label}</Text>
      <Text className="font-sansSemi text-sm text-textPrimary" style={TABULAR}>
        {amount}
      </Text>
    </View>
  )
}

/**
 * One part of the net, on a tile tinted in its own colour with its own glyph — the colour the flow
 * chart below gives the same money. A dot on a grey tile left saved, invested and checking reading
 * as the same thing; the tint and the icon make each one findable at a glance.
 */
function Part({ label, icon, amount, color, isMasked }: { label: string; icon: IconName; amount: number; color: string; isMasked: boolean }) {
  return (
    <View className="flex-row items-center gap-2.5 rounded-xl px-3 py-2.5" style={{ width: '48.5%', backgroundColor: hexToRgba(color, 0.1) }}>
      {/* Bare: the tile is already tinted, and a circle on top of it doubled the outline. */}
      <Ionicons name={icon} size={18} color={color} />
      <View className="flex-1">
        <Text className="font-sansMed text-xs text-textPrimary" numberOfLines={1}>
          {label}
        </Text>
        <Text className="font-sansSemi text-base text-textPrimary" style={TABULAR} numberOfLines={1} adjustsFontSizeToFit>
          {signed(amount, isMasked)}
        </Text>
      </View>
    </View>
  )
}

/**
 * The month's answer, styled as Home's summary is: the net large in the display face with the
 * savings rate under it — the two figures that say how the month went — then money in and out as a
 * pair of chips, then the parts. The parts are shown as a sum on purpose: they add up to the net exactly
 * (see buildFlowGraph), and seeing that is what lets the user trust the number rather than take it
 * on faith.
 */
export function CashFlowHeadline({ headline, isMasked }: { headline: Headline; isMasked: boolean }) {
  const netColor = headline.net >= 0 ? colors.income : colors.expense
  const rate = headline.savingsRate
  const rateColor = rate == null ? colors.textPrimary : rate >= 0 ? colors.income : colors.expense
  const debtLabel = headline.debtPaid < 0 ? 'Debt added' : 'Debt paid down'

  return (
    <View className="gap-4 rounded-xl bg-surface p-4" style={shadow.sm}>
      {/* The net, then the savings rate in a pill tinted its direction's colour: the second thing to
          read about the month, kept with the net rather than off in a corner of its own. */}
      <View className="items-start gap-2">
        <View className="gap-0.5">
          <Text className="font-sansSemi text-sm text-textPrimary">Net cash flow</Text>
          <Text className="font-display text-2xl" style={{ color: netColor }} numberOfLines={1} adjustsFontSizeToFit>
            {signed(headline.net, isMasked)}
          </Text>
        </View>
        <View className="flex-row items-center gap-1.5 rounded-full px-3 py-1" style={{ backgroundColor: hexToRgba(rateColor, 0.1) }}>
          {rate == null ? (
            <Text className="font-sansMed text-sm text-textPrimary">No income this month</Text>
          ) : (
            <>
              <Text className="font-sansMed text-sm text-textPrimary">Savings rate</Text>
              <Text className="font-sansSemi text-sm" style={[TABULAR, { color: rateColor }]}>
                {Math.round(rate * 100)}%
              </Text>
            </>
          )}
        </View>
      </View>

      {/* In and out side by side, read together as the two halves of the net, as on Home. */}
      <View className="flex-row gap-2">
        <FlowChip icon="arrow-down" iconColor={colors.income} label="In" amount={formatMaskableAmount(headline.income, isMasked)} />
        <FlowChip icon="arrow-up" iconColor={colors.expense} label="Out" amount={formatMaskableAmount(headline.spending, isMasked)} />
      </View>

      {/* Separates income and spending from the parts below, which split the difference between them. */}
      <View style={{ height: 1, backgroundColor: colors.border }} />

      <View className="flex-row flex-wrap justify-between" style={{ rowGap: 8 }}>
        <Part label="Saved" icon="shield-checkmark-outline" amount={headline.saved} color={flowColors.saved} isMasked={isMasked} />
        <Part label="Invested" icon="trending-up" amount={headline.invested} color={flowColors.invested} isMasked={isMasked} />
        <Part label={debtLabel} icon="card-outline" amount={headline.debtPaid} color={flowColors.debtPaid} isMasked={isMasked} />
        <Part label="Checking & cash" icon="wallet-outline" amount={headline.checkingChange} color={colors.transfer} isMasked={isMasked} />
        {headline.unlinked !== 0 ? (
          <Part label="To unlinked accounts" icon="link-outline" amount={headline.unlinked} color={flowColors.unlinked} isMasked={isMasked} />
        ) : null}
        {headline.reimbursements !== 0 ? (
          // Shown from the user's side: positive when more was paid back than fronted this month.
          // The headline's own figure runs the other way (fronted minus repaid), which is what makes
          // the parts sum to income − spending; only the display flips.
          <Part label="Reimbursements" icon="arrow-undo-outline" amount={-headline.reimbursements} color={colors.reimbursed} isMasked={isMasked} />
        ) : null}
      </View>
    </View>
  )
}
