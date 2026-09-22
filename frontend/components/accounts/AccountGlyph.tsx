import { Image, View } from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import { colors } from '@/constants/theme'

/**
 * An account's mark: the institution's logo when Plaid supplied one, otherwise the same
 * Ionicon the accounts list falls back to, on a neutral circle.
 *
 * The circle is what makes the two interchangeable. A bare glyph beside a logo reads as a
 * missing image; give it a surface of its own and it reads as a deliberate stand-in, at the
 * same visual weight as the logos around it.
 *
 * Icon colours come from the account's variant rather than from the surrounding text, so a
 * wallet is blue and cash is green wherever either appears.
 */
export function AccountGlyph({
  logo,
  icon,
  iconColor,
  size,
  background,
}: {
  logo?: string | null
  icon?: { name: string; color: string } | null
  iconColor?: string
  size: number
  /** Surface behind the fallback glyph. Defaults to the neutral raised surface; a caller whose
   *  own layout already tints this spot passes that tint instead, so swapping a hand-rolled
   *  circle for this component leaves the logo-less case looking identical. */
  background?: string
}) {
  if (logo) {
    return (
      <Image
        source={{ uri: `data:image/png;base64,${logo}` }}
        style={{ width: size, height: size, borderRadius: size / 4, flexShrink: 0 }}
        resizeMode="contain"
      />
    )
  }
  if (!icon) return null
  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: size / 2,
        backgroundColor: background ?? colors.surfaceRaised,
        alignItems: 'center',
        justifyContent: 'center',
        flexShrink: 0,
      }}
    >
      <Ionicons name={icon.name as never} size={Math.max(size * 0.62, 8)} color={iconColor ?? icon.color} />
    </View>
  )
}
