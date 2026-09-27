import { assetClassColors, colors, hexToRgba } from '@/constants/theme'
import type { Holding } from '@/types/domain'

/**
 * Per-share average cost. Plaid's cost_basis is the TOTAL basis for the position, so this
 * is basis/quantity — null when the institution didn't report a basis (common for sweeps
 * and some brokerages) or the quantity is zero/negative (short positions aren't averaged).
 */
export function averageCost(holding: Holding): number | null {
  if (holding.costBasis == null || holding.quantity <= 0) return null
  return holding.costBasis / holding.quantity
}

/**
 * Compact symbol: options render from Plaid's parsed option_contract ("NFLX 355C") —
 * never the raw OCC string ("NFLX180201C00355000"). An unparsed OCC ticker degrades to
 * "NFLX OPT"; plain holdings keep their ticker.
 */
export function compactSymbol(holding: Pick<Holding, 'ticker' | 'type' | 'optionContract'>): string | null {
  const contract = holding.optionContract
  if (contract?.underlyingTicker) {
    const kind = contract.contractType?.charAt(0).toUpperCase() ?? ''
    return `${contract.underlyingTicker} ${formatShares(contract.strikePrice)}${kind}`
  }
  const occ = holding.ticker?.match(/^([A-Z]{1,6})\d{6}[CP]\d{8}$/)
  if (occ) return `${occ[1]} OPT`
  return holding.ticker
}

/** Display label: compact symbol when known, else security name, else a placeholder. */
export function holdingLabel(holding: Holding): string {
  return compactSymbol(holding) ?? holding.name ?? 'Unknown holding'
}

/**
 * Shares formatted for display across the whole range brokerages report:
 *  - huge counts compact like money (12.35k, 1M) — cash sweeps count "shares" in dollars;
 *  - whole numbers stay whole, normal fractions keep up to 4 decimals trimmed;
 *  - dust positions (< 0.0001) keep two significant digits instead of rounding to 0.
 */
export function formatShares(quantity: number): string {
  const abs = Math.abs(quantity)
  if (abs >= 10_000) {
    const millions = abs >= 1_000_000
    const scaled = millions ? quantity / 1_000_000 : quantity / 1_000
    const text = (Math.abs(scaled) >= 100 ? scaled.toFixed(1) : scaled.toFixed(2)).replace(/\.?0+$/, '')
    return `${text}${millions ? 'M' : 'k'}`
  }
  if (Number.isInteger(quantity)) return String(quantity)
  if (abs < 0.0001) {
    const text = quantity.toPrecision(2)
    return text.includes('e') ? quantity.toFixed(8).replace(/0+$/, '') : text
  }
  return quantity.toFixed(4).replace(/0+$/, '').replace(/\.$/, '')
}

/** Total market value across holdings, for the sheet header sanity line. */
export function totalHoldingsValue(holdings: Holding[]): number {
  return holdings.reduce((sum, h) => sum + (h.institutionValue ?? 0), 0)
}

/**
 * Unrealized gain: market value minus the total cost basis. Null when the institution
 * reports no basis (sweeps and some brokerages) or no value.
 *
 * Guards more loosely than holdingGainPct below, on purpose: that one must divide by the
 * basis and so needs it positive, while a zero-basis position (gifted shares, a fully
 * written-down lot) has a perfectly real dollar gain and no meaningful percent.
 */
export function holdingGain(holding: Holding): number | null {
  if (holding.costBasis == null || holding.institutionValue == null) return null
  return holding.institutionValue - holding.costBasis
}

/**
 * The whole account's unrealized gain, in dollars and as a share of its total cost basis. Basis
 * comes from the institution and has no window, so unlike totalReturn this never overstates — it
 * just leaves out what was already realized.
 *
 * A cash position with no reported basis counts as neither gain nor basis — cash cannot have
 * gained anything, and institutions often leave its basis out. Any other position missing a basis
 * makes the result null: a total that silently skips a security is wrong, not merely smaller.
 */
export function accountGain(holdings: Holding[]): { gain: number; pct: number | null } | null {
  if (holdings.length === 0) return null
  let gain = 0
  let basis = 0
  for (const holding of holdings) {
    const g = holdingGain(holding)
    if (g != null) {
      gain += g
      basis += holding.costBasis ?? 0
    } else if (holding.type !== 'cash') {
      return null
    }
  }
  return { gain: Math.round(gain * 100) / 100, pct: basis > 0 ? gain / basis : null }
}

/** (value - total basis) / basis; null when the institution reports no usable basis. */
export function holdingGainPct(holding: Holding): number | null {
  if (holding.costBasis == null || holding.costBasis <= 0 || holding.institutionValue == null) return null
  return (holding.institutionValue - holding.costBasis) / holding.costBasis
}

/**
 * Holdings largest-position-first. Copies rather than sorts in place — the array comes
 * straight from the query cache, and reordering that in place would mutate shared state.
 *
 * Matches the order the heat map lays its tiles in (computeAllocation sorts by weight),
 * so the table reads top-to-bottom as the map reads left-to-right. Holdings the
 * institution gave no value for sort last: they can't be ranked, and floating an unknown
 * above a real position would misrepresent it as the biggest thing in the account.
 */
export function sortHoldingsByValue(holdings: Holding[]): Holding[] {
  return [...holdings].sort((a, b) => (b.institutionValue ?? -Infinity) - (a.institutionValue ?? -Infinity))
}

/**
 * When the account's holdings were last priced by the institution: the OLDEST date across
 * them, not the newest.
 *
 * A total is only as current as its stalest input. Reporting the newest would let one
 * actively-quoted position vouch for a portfolio whose other holdings haven't repriced in
 * days — precisely the impression this label exists to prevent.
 *
 * Undated holdings are skipped rather than treated as infinitely old: cash sweeps routinely
 * carry no price date, and letting one veto the label would hide the staleness of every real
 * position beside it. Null only when nothing is dated at all.
 */
export function holdingsPricedAsOf(holdings: Holding[]): string | null {
  return holdings.reduce<string | null>((oldest, holding) => {
    if (!holding.priceAsOf) return oldest
    // ISO 8601 sorts lexicographically, but only within one precision — comparing a date-only
    // "2026-08-23" against "2026-08-23T20:00:00Z" would call the bare date older by prefix.
    // Parsing sidesteps that entirely.
    if (oldest == null) return holding.priceAsOf
    return Date.parse(holding.priceAsOf) < Date.parse(oldest) ? holding.priceAsOf : oldest
  }, null)
}

/**
 * Width in px for one auto-sized table column: the widest cell across every text style
 * rendered in it, plus a gutter.
 *
 * Character count times advance is only a sound measurement because the numeric cells use
 * a fixed-advance (monospace) font, where every glyph is exactly `charWidth` across. Each
 * group carries its own advance so a column can mix styles — PRICE stacks a 14px mono
 * figure over a 10px "avg" subline, and the column has to clear both.
 *
 * Callers must NOT pass proportional-font text: "MMM" and "iii" have the same length and
 * wildly different widths, so the result would be a guess wearing a number's clothes.
 */
export function columnWidth(groups: Array<{ cells: string[]; charWidth: number }>): number {
  const widest = groups.reduce((max, group) => {
    // reduce, not Math.max(...spread): an empty column must yield 0, not -Infinity.
    const longest = group.cells.reduce((n, cell) => Math.max(n, cell.length), 0)
    return Math.max(max, longest * group.charWidth)
  }, 0)
  return Math.ceil(widest + COLUMN_GUTTER)
}

/** Breathing room between auto-sized columns. */
const COLUMN_GUTTER = 12

/**
 * Gain percent for display: always signed, so a gain reads as a gain at a glance rather
 * than as a bare number. Em dash when the institution reported no usable basis — never
 * "0.0%", which would claim the position is flat.
 */
export function formatGainPct(gainPct: number | null): string {
  if (gainPct == null) return '\u2014'
  return `${gainPct < 0 ? '-' : '+'}${Math.abs(gainPct * 100).toFixed(1)}%`
}

/**
 * One performance color scale for the whole investments UI: the heat map tiles and the
 * table's monogram icons draw from the same function, so a holding keeps its color across
 * both. Green gain / red loss, deeper = larger move (saturating at +/-25%); neutral when
 * no basis is reported. `base` is for text/strokes, `fill` the translucent surface.
 */
export function performanceColor(gainPct: number | null): { base: string; fill: string } {
  if (gainPct == null) return { base: colors.textMuted, fill: colors.surfaceRaised }
  const base = gainPct >= 0 ? colors.income : colors.expense
  const alpha = 0.12 + Math.min(Math.abs(gainPct) / 0.25, 1) * 0.38
  return { base, fill: hexToRgba(base, alpha) }
}

/** 1-2 character monogram: "VTI" -> "VT", "Bitcoin" -> "BI". */
export function monogramText(label: string): string {
  return label.replace(/[^A-Za-z0-9]/g, '').slice(0, 2).toUpperCase() || '?'
}

// --- Asset-class scale (allocation view) -------------------------------------------------
// The heat map colors by WHAT a holding is, never by performance: red/green on a treemap
// universally reads as "today's movement" (the finviz convention), which a vs-cost-basis
// tint would falsely imply. Class colors answer "what am I holding", size answers "how
// much" — nothing implies motion.

export interface AssetClass {
  key: string
  label: string
  /** Brighter shade: tile backgrounds (tinted) and legend swatches. */
  color: string
  /** Deep AA-safe shade for label text sitting on this class's tile. */
  textColor: string
  /** Tile text for holdings with no ticker ("U S Dollar" -> CASH). */
  shortLabel: string
}

const ASSET_CLASSES: Record<string, AssetClass> = {
  equity: { key: 'equity', label: 'Stocks', color: assetClassColors.equity.fill, textColor: assetClassColors.equity.text, shortLabel: 'STOCK' },
  etf: { key: 'etf', label: 'ETFs', color: assetClassColors.etf.fill, textColor: assetClassColors.etf.text, shortLabel: 'ETF' },
  'mutual fund': { key: 'mutual fund', label: 'Funds', color: assetClassColors.mutualFund.fill, textColor: assetClassColors.mutualFund.text, shortLabel: 'FUND' },
  'fixed income': { key: 'fixed income', label: 'Bonds', color: assetClassColors.fixedIncome.fill, textColor: assetClassColors.fixedIncome.text, shortLabel: 'BOND' },
  cash: { key: 'cash', label: 'Cash', color: assetClassColors.cash.fill, textColor: assetClassColors.cash.text, shortLabel: 'CASH' },
  cryptocurrency: { key: 'cryptocurrency', label: 'Crypto', color: assetClassColors.cryptocurrency.fill, textColor: assetClassColors.cryptocurrency.text, shortLabel: 'CRYPTO' },
  derivative: { key: 'derivative', label: 'Derivatives', color: assetClassColors.derivative.fill, textColor: assetClassColors.derivative.text, shortLabel: 'DERIV' },
}

const UNKNOWN_CLASS: AssetClass = {
  key: 'other',
  label: 'Other',
  color: assetClassColors.other.fill,
  textColor: assetClassColors.other.text,
  shortLabel: 'OTHER',
}

export function assetClass(type: string | null): AssetClass {
  return (type && ASSET_CLASSES[type]) || UNKNOWN_CLASS
}

/** Treemap tile text: the compact symbol when there is one, else the class short label. */
export function tileLabel(holding: Pick<Holding, 'ticker' | 'type' | 'optionContract'>): string {
  return compactSymbol(holding) ?? assetClass(holding.type).shortLabel
}

/**
 * Day move: latest institution price vs previous session close. Null when either side is
 * missing/zero — and beware staleness: some institutions update prices once a day, so a
 * zero here often means "not repriced yet", not "flat".
 */
export function dayChangePct(holding: Pick<Holding, 'institutionPrice' | 'closePrice'>): number | null {
  if (holding.institutionPrice == null || holding.closePrice == null || holding.closePrice <= 0) return null
  return (holding.institutionPrice - holding.closePrice) / holding.closePrice
}
