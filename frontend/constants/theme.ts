// Single source of truth for design tokens — see docs/design.md.
// No hex values, spacing numbers, or font names should appear outside this file.
//
// Light-mode-first (pivoted 2026-08 from the original dark-mode spec — see design.md's
// changelog note). Every color here doubles as text/icon color in this codebase (see
// SecretInput, TextField, ErrorBanner, SettingsRow), so each is chosen to meet WCAG AA
// contrast against `background`/`surface`, not just to "look like" its dark-mode counterpart.
// Category card pastel fills derive from `categoryColors` via `hexToRgba`, not from these
// semantic tokens — those hues don't need the same text-contrast treatment.

export const colors = {
  background: '#FAFAF8',
  surface: '#FFFFFF',
  surfaceRaised: '#F3F3EF',
  border: '#E8E8E2',
  borderStrong: '#D3D3CA',

  primary: '#0F766E',
  primaryDim: '#0B5C56',
  primaryMuted: 'rgba(15,118,110,0.10)',
  // Rules on glass surfaces, where `border` is too close to the glass to show.
  primaryHairline: 'rgba(15,118,110,0.16)',

  income: '#059669',
  expense: '#E11D48',
  warning: '#B45309',
  reimbursed: '#7C3AED',
  transfer: '#0E7490',

  textPrimary: '#1C1C18',
  textSecondary: '#6E6E64',
  textMuted: '#A8A89C',
  textInverse: '#FFFFFF',
  // A white card's own edge on a white page: lighter than `border`, which reads as a rule, not a rim.
  borderCard: '#E6E6DF',
  // A control's fill on a plain white page: iOS's own neutral fill (the light grey of its segmented
  // controls and search fields) — cool and quiet, where a warm grey or a brand tint read as off.
  controlFill: 'rgba(118,118,128,0.12)',

  // Controls on Home's mint top section where Liquid Glass isn't available (before iOS 26): a light
  // white veil with a soft rim — enough to read as buttons, quiet enough that the net figure stays
  // the loudest thing on the section.
  glass: 'rgba(255,255,255,0.3)',
  glassBorder: 'rgba(255,255,255,0.5)',
  // The comparison pill under the net: information, not a control, so quieter still — a faint veil,
  // no rim.
  glassQuiet: 'rgba(255,255,255,0.22)',
  // Frosted white for the Cash flow pill on Home's mint sheet, and the bright rim catching the light
  // along its edge and the cards' (Card).
  frostCard: 'rgba(255,255,255,0.55)',
  frostCardBorder: 'rgba(255,255,255,0.9)',
} as const

/**
 * The app's page backdrop (PageBackdrop), for any screen that wants more than flat off-white: Home's
 * sheet and its Charts view use it. Stops run top to bottom; the first is also the colour to give
 * the status-bar area above a page that uses it, the last what shows past the bottom.
 */
export const pageBackdrop = {
  // Every page but Home's sheet: plain white, no pools. (The faint mint it had was
  // ['#F6FAF8', '#F8FBF9', '#FAFCFB'] with pools at 0.13 — set those back to bring it to every page.)
  stops: ['#FFFFFF', '#FFFFFF', '#FFFFFF'],
  // Soft pools of other colours drifting through it (PageBackdrop), faint and wide, so the near-white
  // reads as a gentle mesh of light rather than a flat wash: lemon on the right, sky down the left, a
  // lilac haze lower on the right.
  blooms: { lemon: '#FFF1A8', sky: '#BFE2FF', lilac: '#E6D9FF' },
  bloomStrength: 0,
  // Home's sheet: plain white too now. (Its faint mint was ['#F9FCFB', '#FBFDFC', '#FCFEFD'] with
  // pools at 0.08.)
  sheet: { stops: ['#FFFFFF', '#FFFFFF', '#FFFFFF'], bloomStrength: 0 },
  // Home's cards, and its Cash flow pill: iOS's standard frosted material (true) or solid white
  // (false).
  frostedCards: false,
} as const

/**
 * Home's top section: a near-white mint, a breath of colour at the top fading paler still — just enough mint
 * left there that the white sheet's edge, rim and shadow still read where it rides up over it. The
 * section reads as a light wash of brand colour rather than a block, and moving from
 * Home to the other, white tabs doesn't jolt the eye. The brand teal lives on in the data instead
 * (the In/Out pills, the budget bar, the charts, the selected tab). Vertical, so the status bar, the
 * header and the collapsed bar all sit on the same colour across their width. Stops run top to bottom.
 *
 * `pools` are faint pools of other colour washed in from its bottom corners — sky from the
 * bottom-left, lemon from the bottom-right — gone well before the top edge (HeroBackground).
 *
 * `ink` — the text and icons on it — is chosen by contrast rather than by hand: white or the app's
 * near-black, whichever reads better against every stop (readableInk). Here that's the near-black.
 */
export const heroGradient = {
  stops: ['#EEF8F3', '#F3FAF6', '#F7FCF9'],
  pools: { sky: '#BFE2FF', lemon: '#FFF1A8' },
  ink: readableInk(['#EEF8F3', '#F3FAF6', '#F7FCF9']),
} as const

export const categoryColors = {
  foodAndDrink: '#F97316',
  transport: '#3B82F6',
  travel: '#8B5CF6',
  entertainment: '#EC4899',
  shopping: '#EAB308',
  bills: '#6B7280',
  health: '#10B981',
  personalCare: '#F43F5E',
  home: '#84CC16',
  services: '#06B6D4',
  income: '#34D399',
  transfersIn: '#2DD4BF',
  transfersOut: '#9CA3AF',
  loans: '#F87171',
  fees: '#6B7280',
  other: '#71717A',
} as const

/**
 * Asset-class scale for the holdings allocation map. Two tokens per class, following the
 * same split as the semantic colors: `fill` is the brighter shade for tile backgrounds and
 * legend swatches, `text` the deep AA-safe shade for labels sitting on those tiles.
 *
 * Generated as one OKLCH ramp at near-constant lightness — hue does the separating, so no
 * class reads as heavier or more urgent than another. Allocation is a neutral fact and the
 * map must not imply health or motion.
 *
 * The hue band (195°-305°, plus one warm neutral for cash) deliberately avoids every
 * semantic hue: rose (~15°), amber (~70°) and emerald (~155°) sit outside it entirely, and
 * crypto's violet is far less saturated than `reimbursed`. The previous palette used amber,
 * violet and near-rose directly, which had the map speaking the budget-health language while
 * meaning something else.
 *
 * Every `text` clears 6.3:1 against its own tile at 20% fill over `background`.
 */
export const assetClassColors = {
  etf: { fill: '#2A9898', text: '#00585A' },
  fixedIncome: { fill: '#638E99', text: '#1B4F5B' },
  equity: { fill: '#3286C5', text: '#004A8E' },
  mutualFund: { fill: '#657DBF', text: '#2C4188' },
  derivative: { fill: '#7B79B1', text: '#433E7A' },
  cryptocurrency: { fill: '#906DB7', text: '#592F7F' },
  cash: { fill: '#8E8C84', text: '#4A483F' },
  other: { fill: '#828E98', text: '#3E4954' },
} as const

/**
 * Debt in the net-worth composition map. Same fill/text split as the asset classes, but drawn
 * from the rose family so a liability block reads as a liability rather than as another kind
 * of asset — this is the one place that map's neutral "allocation" stance gives way, because
 * owing money genuinely is a different thing from owning it.
 *
 * `text` clears 5.9:1 against its own tile at the deepest tint used.
 */
export const liabilityColors = { fill: '#C2676C', text: '#841428' } as const

/**
 * Cash-flow hub: one color per kind of money movement, used for the headline chips, account-node
 * bars and the ribbons between accounts. Spending ribbons take their category's own color instead.
 * Invested is indigo rather than violet so it can't be read as `reimbursed`.
 */
export const flowColors = {
  income: colors.income,
  saved: colors.primary,
  invested: '#4F46E5',
  debtPaid: colors.warning,
  moved: colors.textSecondary,
  unlinked: colors.textMuted,
  spending: colors.expense,
} as const

// Fallback channels for malformed input. category.color is a free-text DB column (validated
// only as a non-empty string), so a value like 'red' or '#f00' would otherwise parse to NaN
// channels and crash React Native at render time. Falls back to `textMuted` (#A8A89C).
const FALLBACK_RGB = [168, 168, 156] as const

export function hexToRgba(hex: string, alpha: number): string {
  const normalized = hex.replace('#', '')
  if (!/^[0-9a-fA-F]{6}$/.test(normalized)) {
    const [r, g, b] = FALLBACK_RGB
    return `rgba(${r}, ${g}, ${b}, ${alpha})`
  }
  const r = parseInt(normalized.slice(0, 2), 16)
  const g = parseInt(normalized.slice(2, 4), 16)
  const b = parseInt(normalized.slice(4, 6), 16)
  return `rgba(${r}, ${g}, ${b}, ${alpha})`
}

/**
 * The solid colour `hex` at `alpha` produces when laid over `baseHex` — what a translucent tint
 * actually looks like on screen. For overlays that must match a tinted background exactly, such as
 * an edge fade over a selected row, where a second translucent layer would stack instead.
 */
export function blendOver(hex: string, alpha: number, baseHex: string): string {
  const channels = (value: string) => {
    const normalized = value.replace('#', '')
    if (!/^[0-9a-fA-F]{6}$/.test(normalized)) return [...FALLBACK_RGB]
    return [0, 2, 4].map((i) => parseInt(normalized.slice(i, i + 2), 16))
  }
  const top = channels(hex)
  const base = channels(baseHex)
  return `#${top
    .map((c, i) => Math.round(c * alpha + base[i] * (1 - alpha)).toString(16).padStart(2, '0'))
    .join('')}`
}

export const fontFamily = {
  display: 'DMSans_700Bold',
  sans: 'Inter_400Regular',
  sansMed: 'Inter_500Medium',
  sansSemi: 'Inter_600SemiBold',
  mono: 'JetBrainsMono_400Regular',
} as const

export const fontSize = {
  xs: 11,
  sm: 13,
  // Account balances: a step under the 15pt section totals they sit beneath.
  amount: 14,
  base: 15,
  md: 17,
  lg: 22,
  xl: 28,
  '2xl': 36,
  '3xl': 48,
} as const

export const spacing = {
  1: 4,
  2: 8,
  3: 12,
  4: 16,
  5: 20,
  6: 24,
  8: 32,
  10: 40,
  12: 48,
} as const

export const borderRadius = {
  sm: 8,
  md: 14,
  lg: 20,
  xl: 28,
  full: 9999,
} as const

export const shadow = {
  // The everyday card shadow. Tuned for white pages: deep and soft enough that a white card still
  // stands clear of a white background, with no border to help it.
  sm: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.09,
    shadowRadius: 12,
    elevation: 3,
  },
  md: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.1,
    shadowRadius: 14,
    elevation: 4,
  },
  // Small controls and pills on Home's near-white top section: a soft, short drop that lifts a white
  // chip just clear of the wash, without the weight of a card's shadow.
  chip: {
    shadowColor: '#1C1C18',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 6,
    elevation: 2,
  },
  // Home's cards (Card) and the floating tab bar: a soft, neutral drop that lifts them clear of a white page.
  lift: {
    shadowColor: '#1C1C18',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.08,
    shadowRadius: 18,
    elevation: 3,
  },
  card: {
    shadowColor: '#0F766E',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.1,
    shadowRadius: 20,
    elevation: 3,
  },
} as const

/** WCAG relative luminance of a #RRGGBB colour, 0 (black) to 1 (white). Unparseable input counts as black. */
function relativeLuminance(hex: string): number {
  const normalized = hex.replace('#', '')
  if (!/^[0-9a-fA-F]{6}$/.test(normalized)) return 0
  const [r, g, b] = [0, 2, 4].map((i) => {
    const c = parseInt(normalized.slice(i, i + 2), 16) / 255
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

/** WCAG contrast ratio between two #RRGGBB colours, from 1 (none) to 21 (black on white). */
export function contrastRatio(a: string, b: string): number {
  const [light, dark] = [relativeLuminance(a), relativeLuminance(b)].sort((x, y) => y - x)
  return (light + 0.05) / (dark + 0.05)
}

/**
 * Text colour for a background — white (`textInverse`) or the app's near-black (`textPrimary`),
 * whichever has the higher contrast. Given a gradient's stops, it judges each candidate by its worst
 * stop, so the text holds up wherever it sits on the gradient. Accessibility decides, not taste:
 * WCAG AA asks 4.5:1 for body text and 3:1 for large text.
 */
export function readableInk(backgrounds: string | readonly string[]): string {
  const stops = typeof backgrounds === 'string' ? [backgrounds] : backgrounds
  const candidates = [colors.textInverse, colors.textPrimary]
  const worst = (ink: string) => Math.min(...stops.map((bg) => contrastRatio(ink, bg)))
  return candidates.reduce((best, ink) => (worst(ink) > worst(best) ? ink : best))
}
