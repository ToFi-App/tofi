import { View } from 'react-native'
import { colors } from '@/constants/theme'
import { ListCard, ListCardValue } from '@/components/networth/ListCard'
import { ChangeLabel } from '@/components/networth/ChangeLabel'
import {
  assetClass,
  formatGainPct,
  formatShares,
  holdingGain,
  holdingGainPct,
  holdingLabel,
  monogramText,
  sortHoldingsByValue,
} from '@/lib/accounts/holdings'
import { formatMaskableAmount } from '@/lib/format/money'
import { securityLogoUrl } from '@/lib/investments/securityLogo'
import { SecurityMark } from './SecurityMark'
import type { Holding } from '@/types/domain'

/** A change in a holding's value: dollars, and the share of where it started. */
export type HoldingChange = { gain: number; pct: number | null }

/** The holding's mark beside its row: its logo, or a monogram in its asset class's colour. */
const MARK_SIZE = 36

interface HoldingRowsProps {
  holdings: Holding[]
  isMasked: boolean
  /** Opens a holding's own page. */
  onOpen: (securityId: string) => void
  /** Each row's change over the window the chart above shows, in place of its total return — so
   *  the rows read the same range the chart does. Null: no figure for that window. */
  changeFor?: (holding: Holding) => HoldingChange | null
  /** Each row's share of the whole, shown in place of its change: the allocation view's reading. */
  weightOf?: (holding: Holding) => number
}

/**
 * The positions in view, largest first, one tile each: the mark, the symbol over the security's name
 * and the shares held, and on the right the value with how it did — over the chart's window, or the
 * total return from cost when there's no window — in gain green or loss red. Each opens the
 * holding's own page, where price, position and trades are.
 *
 * GAIN% is unmasked on purpose — a ratio discloses no balance, and privacy mode is most useful when
 * it still answers "how is this doing".
 */
export function HoldingRows({ holdings, isMasked, onOpen, changeFor, weightOf }: HoldingRowsProps) {
  return (
    <View>
      {sortHoldingsByValue(holdings).map((holding) => {
        const label = holdingLabel(holding)
        const cls = assetClass(holding.type)
        const change = changeFor ? changeFor(holding) : undefined
        const gain = change !== undefined ? (change?.gain ?? null) : holdingGain(holding)
        const gainPct = change !== undefined ? (change?.pct ?? null) : holdingGainPct(holding)
        const value = holding.institutionValue != null ? formatMaskableAmount(holding.institutionValue, isMasked) : '—'
        const shares = holding.type === 'cash' ? 'Cash' : `${formatShares(holding.quantity)} shares`
        return (
          <View key={holding.securityId} className="pb-2">
            <ListCard
              mark={<SecurityMark uri={securityLogoUrl(holding)} monogram={monogramText(label)} color={cls.color} size={MARK_SIZE} />}
              title={label}
              subtitle={holding.ticker && holding.name ? holding.name : shares}
              accessibilityLabel={`${label}, ${value}`}
              onPress={() => onOpen(holding.securityId)}
              right={
                <>
                  <ListCardValue>{value}</ListCardValue>
                  {weightOf ? (
                    <ListCardValue color={colors.textSecondary}>{formatWeight(weightOf(holding))}</ListCardValue>
                  ) : gain != null ? (
                    <ChangeLabel change={gain} text={gainPct != null ? formatGainPct(gainPct) : formatMaskableAmount(gain, isMasked)} size="xs" />
                  ) : (
                    <ListCardValue color={colors.textMuted}>{change !== undefined ? '—' : 'No cost basis'}</ListCardValue>
                  )}
                </>
              }
            />
          </View>
        )
      })}
    </View>
  )
}

/** A share of the whole, to a tenth of a percent; a sliver reads as under 0.1% rather than 0%. */
function formatWeight(share: number): string {
  return share > 0 && share < 0.001 ? '<0.1%' : `${(share * 100).toFixed(1)}%`
}
