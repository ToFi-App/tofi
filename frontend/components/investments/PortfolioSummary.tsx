import { useState } from 'react'
import { Pressable, Text, View } from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import { borderRadius, colors, shadow } from '@/constants/theme'
import { AccountGlyph } from '@/components/accounts/AccountGlyph'
import { HoldingRows, SharePill, type HoldingChange } from '@/components/accounts/HoldingRows'
import { assetClass, formatGainPct, performanceColor } from '@/lib/accounts/holdings'
import { formatMaskableAmount } from '@/lib/format/money'
import type { Holding } from '@/types/domain'

function percent(share: number): string {
  return share > 0 && share < 0.005 ? '<1%' : `${Math.round(share * 100)}%`
}

export interface AccountSummaryRow {
  accountId: string
  name: string
  logo: string | null
  icon: { name: string; color: string }
  value: number
  /** Gain over the chart's window (trend) or the account's total return (breakdown); null when unknown. */
  gain: { gain: number; pct: number | null } | null
  holdings: Holding[]
}

interface AccountListProps {
  rows: AccountSummaryRow[]
  isMasked: boolean
  /** Each position's change over the chart's window, read against its account's own trades; absent
   *  in breakdown, where rows read total return. */
  changeFor?: (holding: Holding, accountId: string) => HoldingChange | null
  selectedHoldingId: string | null
  onSelectHolding: (securityId: string | null) => void
  /** Opens a position as held in that one account, so its page reads only that account's shares and trades. */
  onOpenHolding: (securityId: string, accountId: string) => void
  onOpenAccount: (accountId: string) => void
}

/**
 * The accounts, each closed to one line — value, how it did, its share of the whole — and each
 * opening in place onto its positions. How an account is doing comes first; what's inside it is
 * the second look, one tap down, without leaving the page.
 */
export function AccountList({ rows, isMasked, changeFor, selectedHoldingId, onSelectHolding, onOpenHolding, onOpenAccount }: AccountListProps) {
  const [openIds, setOpenIds] = useState<Set<string>>(() => new Set())
  const total = rows.reduce((sum, row) => sum + Math.max(0, row.value), 0)
  const toggle = (accountId: string) =>
    setOpenIds((current) => {
      const next = new Set(current)
      if (next.has(accountId)) next.delete(accountId)
      else next.add(accountId)
      return next
    })

  return (
    <View className="gap-3">
      <Text className="font-sansSemi text-md text-textPrimary">Accounts</Text>
      {rows.map((row) => {
        const { gain } = row
        const isOpen = openIds.has(row.accountId)
        const tone = gain ? (gain.pct != null ? performanceColor(gain.pct).base : gain.gain >= 0 ? colors.income : colors.expense) : colors.textSecondary
        return (
          // Each account its own card, so where one ends and the next begins is never in doubt.
          <View key={row.accountId} style={[shadow.sm, { borderRadius: borderRadius.xl, backgroundColor: colors.surface }]} className="px-4">
            <Pressable
              onPress={() => toggle(row.accountId)}
              accessibilityRole="button"
              accessibilityState={{ expanded: isOpen }}
              accessibilityLabel={`${row.name}, ${isOpen ? 'hide' : 'show'} positions`}
              className="flex-row items-center gap-3 py-3"
            >
              <AccountGlyph logo={row.logo} icon={row.icon} size={32} />
              {/* Two lines like a position row — name over a subtitle — so account and positions read
                  as one list at two depths. */}
              <View className="flex-1">
                <View className="flex-row items-center gap-1.5">
                  <Text className="shrink font-sansSemi text-base text-textPrimary" numberOfLines={1}>
                    {row.name}
                  </Text>
                  <SharePill share={total > 0 ? Math.max(0, row.value) / total : 0} />
                </View>
                <Text className="mt-0.5 font-sans text-sm text-textSecondary">
                  {row.holdings.length} {row.holdings.length === 1 ? 'position' : 'positions'}
                </Text>
              </View>
              <View className="items-end gap-0.5">
                <Text className="font-sansSemi text-base text-textPrimary">{formatMaskableAmount(row.value, isMasked)}</Text>
                {gain && gain.gain !== 0 ? (
                  <Text className="font-sansMed text-xs" style={{ color: tone }}>
                    {gain.gain > 0 ? '+' : '−'}
                    {formatMaskableAmount(Math.abs(gain.gain), isMasked)}
                    {gain.pct != null ? ` (${formatGainPct(gain.pct)})` : ''}
                  </Text>
                ) : null}
              </View>
              <Ionicons name={isOpen ? 'chevron-up' : 'chevron-down'} size={16} color={colors.textSecondary} />
            </Pressable>

            {isOpen ? (
              // Inside the account's card, a rule below its heading.
              <View className="border-t" style={{ borderTopColor: colors.border }}>
                {row.holdings.length > 0 ? (
                  <HoldingRows
                    holdings={row.holdings}
                    isMasked={isMasked}
                    selectedId={selectedHoldingId}
                    onSelect={onSelectHolding}
                    onOpen={(securityId) => onOpenHolding(securityId, row.accountId)}
                    flat
                    changeFor={changeFor ? (holding) => changeFor(holding, row.accountId) : undefined}
                  />
                ) : (
                  <Text className="py-4 font-sansMed text-sm text-textSecondary">No positions</Text>
                )}
                <Pressable
                  onPress={() => onOpenAccount(row.accountId)}
                  accessibilityRole="button"
                  className="flex-row items-center justify-between border-t py-2.5"
                  style={{ borderTopColor: colors.border }}
                >
                  <Text className="font-sansSemi text-base text-primary">View account</Text>
                  <Ionicons name="chevron-forward" size={16} color={colors.primary} />
                </Pressable>
              </View>
            ) : null}
          </View>
        )
      })}
    </View>
  )
}

/**
 * What the portfolio is made of, by asset class: one bar cut into each class's share in the holdings
 * map's own colours, and the classes named under it with their shares, largest first.
 */
export function AssetAllocation({ holdings }: { holdings: Holding[] }) {
  const byClass = new Map<string, { cls: ReturnType<typeof assetClass>; value: number }>()
  for (const holding of holdings) {
    const cls = assetClass(holding.type)
    const entry = byClass.get(cls.key) ?? { cls, value: 0 }
    entry.value += Math.max(0, holding.institutionValue ?? 0)
    byClass.set(cls.key, entry)
  }
  const classes = [...byClass.values()].filter((c) => c.value > 0).sort((a, b) => b.value - a.value)
  const total = classes.reduce((sum, c) => sum + c.value, 0)
  if (total <= 0) return null

  return (
    <View className="gap-3">
      <View className="flex-row overflow-hidden rounded-full" style={{ height: 10, gap: 2 }}>
        {classes.map(({ cls, value }) => (
          <View key={cls.key} style={{ flex: value, backgroundColor: cls.color }} />
        ))}
      </View>
      <View className="flex-row flex-wrap" style={{ columnGap: 16, rowGap: 6 }}>
        {classes.map(({ cls, value }) => (
          <View key={cls.key} className="flex-row items-center gap-1.5">
            <View className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: cls.color }} />
            <Text className="font-sansMed text-sm text-textPrimary">{cls.label}</Text>
            <Text className="font-sansMed text-sm text-textSecondary">{percent(value / total)}</Text>
          </View>
        ))}
      </View>
    </View>
  )
}
