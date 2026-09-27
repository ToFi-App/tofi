import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg'
import { colors } from '@/constants/theme'

/**
 * A teal fade for a sheet's `background`: strongest at the top, nearly gone by the bottom. Pair it
 * with `grabberColor={colors.textMuted}` — the default grabber pill disappears into the tint.
 */
function TealSheetBackdrop() {
  return (
    <Svg width="100%" height="100%">
      <Defs>
        <LinearGradient id="tealSheetFade" x1="0" y1="0" x2="0" y2="1">
          {/* Subtle on purpose: a tint behind the content, not a colour of its own. */}
          <Stop offset="0" stopColor={colors.primary} stopOpacity={0.045} />
          <Stop offset="1" stopColor={colors.primary} stopOpacity={0.01} />
        </LinearGradient>
      </Defs>
      <Rect x="0" y="0" width="100%" height="100%" fill="url(#tealSheetFade)" />
    </Svg>
  )
}

/** Built once: a fresh element per render would be a new prop to the sheet every time. */
export const TEAL_SHEET_BACKDROP = <TealSheetBackdrop />
