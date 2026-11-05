import { memo, useState } from 'react'
import { Image, Text, View } from 'react-native'
import { colors, hexToRgba } from '@/constants/theme'

/** Logo URLs that already failed to load this session (offline, CDN down), so later mounts keep
 *  the monogram instead of asking again and flashing. */
const failedLogos = new Set<string>()

/**
 * A holding's mark: the CDN's image (the company's logo, or its letter icon for a ticker with
 * none), otherwise a monogram in the asset class's colour — for holdings with nothing to look up,
 * like cash, and for an image that won't load.
 *
 * Shaped like AccountGlyph: a logo is a rounded square, the stand-in a circle. The CDN's logos
 * are full-bleed squares, and a circle crops their corners — and with them the edges of the mark.
 *
 * The monogram is drawn first and the logo laid over it, so a slow or failed load never shows
 * an empty circle: the monogram is there until the logo lands, and stays if it never does. The
 * logo's own surface goes on only once it has loaded, for logos with transparent corners.
 *
 * `force-cache` serves a logo from the on-device HTTP cache without revalidating, so a portfolio
 * downloads each logo once rather than on every visit.
 */
export const SecurityMark = memo(function SecurityMark({
  uri,
  monogram,
  color,
  size,
}: {
  uri: string | null
  monogram: string
  color: string
  size: number
}) {
  const [loadedUri, setLoadedUri] = useState<string | null>(null)
  const [failedUri, setFailedUri] = useState<string | null>(null)
  const showLogo = uri != null && uri !== failedUri && !failedLogos.has(uri)

  return (
    <View style={{ width: size, height: size }}>
      <View
        style={{
          width: size,
          height: size,
          borderRadius: size / 2,
          backgroundColor: hexToRgba(color, 0.18),
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <Text className="font-sansSemi text-xs" style={{ color }}>
          {monogram}
        </Text>
      </View>
      {showLogo ? (
        <Image
          source={{ uri, cache: 'force-cache' }}
          style={{
            position: 'absolute',
            width: size,
            height: size,
            borderRadius: size / 4,
            backgroundColor: loadedUri === uri ? colors.surface : 'transparent',
          }}
          resizeMode="contain"
          accessibilityIgnoresInvertColors
          onLoad={() => setLoadedUri(uri)}
          onError={() => {
            failedLogos.add(uri)
            setFailedUri(uri)
          }}
        />
      ) : null}
    </View>
  )
})

/**
 * Just the logo, for a spot too small for a monogram (a treemap tile): its space stays clear
 * until the image has loaded, and goes if it never does, so a tile without one shows its name.
 * Held at full size while loading rather than zero width, which iOS may decline to load into.
 */
export const SecurityLogo = memo(function SecurityLogo({ uri, size }: { uri: string; size: number }) {
  const [isLoaded, setIsLoaded] = useState(false)
  const [hasFailed, setHasFailed] = useState(() => failedLogos.has(uri))
  if (hasFailed) return null
  return (
    <Image
      source={{ uri, cache: 'force-cache' }}
      style={{
        width: size,
        height: size,
        opacity: isLoaded ? 1 : 0,
        borderRadius: size / 4,
        backgroundColor: colors.surface,
        flexShrink: 0,
      }}
      resizeMode="contain"
      accessibilityIgnoresInvertColors
      onLoad={() => setIsLoaded(true)}
      onError={() => {
        failedLogos.add(uri)
        setHasFailed(true)
      }}
    />
  )
})
