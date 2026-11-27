import { Text, View } from 'react-native'
import Svg, { Circle, G } from 'react-native-svg'
import { colors, hexToRgba } from '@/constants/theme'
import { AccountGlyph } from '@/components/accounts/AccountGlyph'
import { ListCard, ListCardValue } from '@/components/networth/ListCard'
import { ChangeLabel } from '@/components/networth/ChangeLabel'
import { assetClass, formatGainPct } from '@/lib/accounts/holdings'
import { formatMaskableAmount } from '@/lib/format/money'
import type { Holding } from '@/types/domain'

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

/**
 * The accounts behind the portfolio, largest first, one tile each: value, how it did, and how many
 * positions it holds. Each opens the Investments view filtered to it, where its own chart and
 * positions are.
 */
export function AccountList({
  rows,
  isMasked,
  onOpenAccount,
}: {
  rows: AccountSummaryRow[]
  isMasked: boolean
  onOpenAccount: (accountId: string) => void
}) {
  return (
    <View>
      {rows.map((row) => {
        const { gain } = row
        const count = row.holdings.length
        return (
          <View key={row.accountId} className="pb-2">
            <ListCard
              mark={<AccountGlyph logo={row.logo} icon={row.icon} size={36} background={hexToRgba(row.icon.color, 0.1)} />}
              title={row.name}
              subtitle={`${count} ${count === 1 ? 'position' : 'positions'}`}
              accessibilityLabel={`${row.name}, ${formatMaskableAmount(row.value, isMasked)}`}
              onPress={() => onOpenAccount(row.accountId)}
              right={
                <>
                  <ListCardValue>{formatMaskableAmount(row.value, isMasked)}</ListCardValue>
                  {gain && gain.gain !== 0 ? (
                    <ChangeLabel
                      change={gain.gain}
                      text={gain.pct != null ? formatGainPct(gain.pct) : formatMaskableAmount(Math.abs(gain.gain), isMasked)}
                      size="xs"
                    />
                  ) : null}
                </>
              }
            />
          </View>
        )
      })}
    </View>
  )
}

const DONUT_SIZE = 150
const DONUT_STROKE = 16
const DONUT_R = (DONUT_SIZE - DONUT_STROKE) / 2
const DONUT_C = 2 * Math.PI * DONUT_R
/** The gap left between two classes' arcs, along the ring. */
const DONUT_GAP = 4

/** Each class's share of the holdings' value, largest first, with its colour and label. */
export function allocationByClass(holdings: Holding[]) {
  const byClass = new Map<string, { cls: ReturnType<typeof assetClass>; value: number }>()
  for (const holding of holdings) {
    const cls = assetClass(holding.type)
    const entry = byClass.get(cls.key) ?? { cls, value: 0 }
    entry.value += Math.max(0, holding.institutionValue ?? 0)
    byClass.set(cls.key, entry)
  }
  const classes = [...byClass.values()].filter((c) => c.value > 0).sort((a, b) => b.value - a.value)
  const total = classes.reduce((sum, c) => sum + c.value, 0)
  return { classes: classes.map((c) => ({ ...c, share: total > 0 ? c.value / total : 0 })), total }
}

/**
 * What the portfolio is made of, by asset class: a ring cut into each class's share in the asset
 * classes' own colours, and the classes listed beside it with their shares, largest first. The
 * colours say what a holding is, never how it did, so nothing here is green or red.
 */
export function AllocationDonut({ holdings }: { holdings: Holding[] }) {
  const { classes, total } = allocationByClass(holdings)
  if (total <= 0) return null
  // Only cut gaps between two or more arcs: a lone class is the whole ring.
  const gap = classes.length > 1 ? DONUT_GAP : 0
  let offset = 0

  return (
    <View className="flex-row items-center gap-6">
      <Svg
        width={DONUT_SIZE}
        height={DONUT_SIZE}
        accessibilityLabel={classes.map(({ cls, share }) => `${cls.label} ${percent(share)}`).join(', ')}
      >
        <G rotation={-90} origin={`${DONUT_SIZE / 2}, ${DONUT_SIZE / 2}`}>
          {classes.map(({ cls, share }) => {
            const length = Math.max(share * DONUT_C - gap, 0.5)
            const arc = (
              <Circle
                key={cls.key}
                cx={DONUT_SIZE / 2}
                cy={DONUT_SIZE / 2}
                r={DONUT_R}
                fill="none"
                stroke={cls.color}
                strokeWidth={DONUT_STROKE}
                strokeDasharray={`${length} ${DONUT_C - length}`}
                strokeDashoffset={-offset}
              />
            )
            offset += share * DONUT_C
            return arc
          })}
        </G>
      </Svg>
      <View className="flex-1 gap-3.5">
        {classes.map(({ cls, share }) => (
          <View key={cls.key} className="flex-row items-center gap-2">
            <View className="h-2 w-2 rounded-full" style={{ backgroundColor: cls.color }} />
            <Text className="flex-1 font-sansMed text-sm text-textPrimary" numberOfLines={1}>
              {cls.label}
            </Text>
            <Text className="font-sans text-sm" style={{ color: colors.textSecondary, fontVariant: ['tabular-nums'] }}>
              {percent(share)}
            </Text>
          </View>
        ))}
      </View>
    </View>
  )
}

function percent(share: number): string {
  return share > 0 && share < 0.001 ? '<0.1%' : `${(share * 100).toFixed(1)}%`
}
