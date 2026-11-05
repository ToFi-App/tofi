import { Pressable, Text, View } from 'react-native'
import { hexToRgba } from '@/constants/theme'
import { AccountGlyph } from '@/components/accounts/AccountGlyph'
import { SecurityLogo } from '@/components/accounts/SecurityMark'

/**
 * One tile in a treemap, shared by the holdings map and the net-worth composition map.
 *
 * The map has to read as ONE object subdivided, not a scatter of separate cards. Everything
 * here is tuned to that: the gap is wide enough to separate two neighbours of the same colour
 * and no wider, and the radius is small enough that tiles still feel cut from a shared
 * surface. Push either up and the treemap stops looking like a whole.
 */
export const TILE_GAP = 3
export const TILE_RADIUS = 5

/**
 * Content tiers, by how much room a tile actually has. A tile never renders a line it cannot
 * finish: it drops detail in order of what the reader can most afford to lose — the account
 * number first, then the name, leaving the logo and the share, which are the two things that
 * still identify a block at a glance.
 */
/**
 * Logo and name share ONE line, with the share beneath. Sized from what that occupies:
 * 12px padding + ~16px for the logo/name row + 2px + ~12px share ≈ 42. Putting the name
 * beside the logo rather than under it is what makes this fit where a stack could not.
 */
const NAME_HEIGHT = 42
/**
 * Too short for a name; the icon and share sit side by side instead. Sized so that row
 * genuinely fits — 12px padding plus a ~14px glyph — because this is the floor the layout
 * guarantees. Every tile therefore shows at least an icon and a percentage, which is enough
 * to identify it without tapping.
 */
const COMPACT_HEIGHT = 26
/** Narrower than this and even a compact row has nothing to say. */
export const MIN_LABEL_SIZE = 34
/** Below this, a logo has nowhere to sit. */
const MIN_LOGO_SIZE = 22

/**
 * Type scale for a tile's label, stepped by how much room it has. A treemap where every label
 * is the same size wastes its own hierarchy — the dominant position should announce itself
 * louder than a 3% one, in type as well as area.
 */
export function labelScale(width: number, height: number) {
  const min = Math.min(width, height)
  if (min >= 90) return { title: 15, share: 11, pad: 10 }
  if (min >= 56) return { title: 13, share: 10, pad: 8 }
  return { title: 11, share: 9, pad: 6 }
}

interface TreemapTileProps {
  x: number
  y: number
  width: number
  height: number
  /** Base hue; the tile fills with this at `tint`, and labels use `textColor`. */
  color: string
  textColor: string
  tint: number
  title: string
  share: string
  /** Base64 PNG institution logo. */
  logo?: string | null
  /** Drawn when there is no logo — a built-in row, or an institution Plaid has none for. */
  fallbackIcon?: { name: string; color: string } | null
  /** A security's logo from the CDN, for the holdings map; dropped quietly if it won't load. */
  logoUri?: string | null
  /** Makes the tile tappable — the only way to identify a tile too small to carry a label. */
  onPress?: () => void
  isSelected?: boolean
}

export function TreemapTile({
  x,
  y,
  width,
  height,
  color,
  textColor,
  tint,
  title,
  share,
  logo,
  fallbackIcon,
  logoUri,
  onPress,
  isSelected = false,
}: TreemapTileProps) {
  // Inset rather than a smaller rect from squarify: the layout math stays pure and the gap is
  // presentation, so tile areas remain exactly proportional to value.
  // The gap is dropped on any axis too small to afford it. Insetting by GAP/2 while clamping
  // the drawn size to a 1px minimum makes a sub-gap tile spill past its own rect and overlap
  // its neighbour — so a tile narrower or shorter than the gap simply fills its rect exactly.
  const gapX = width > TILE_GAP * 2 ? TILE_GAP : 0
  const gapY = height > TILE_GAP * 2 ? TILE_GAP : 0
  const tileW = Math.max(width - gapX, 0)
  const tileH = Math.max(height - gapY, 0)
  const type = labelScale(tileW, tileH)
  const wideEnough = tileW >= MIN_LABEL_SIZE
  const showName = wideEnough && tileH >= NAME_HEIGHT
  // A short tile lays its logo and share on ONE line: stacking them would need vertical room
  // it does not have, and the width is exactly what preferWide bought it.
  const compact = wideEnough && !showName && tileH >= COMPACT_HEIGHT
  const showShare = showName || compact
  const showLogo = (!!logo || !!fallbackIcon || !!logoUri) && tileW >= MIN_LOGO_SIZE && tileH >= MIN_LOGO_SIZE
  const hasContent = showLogo || showName || showShare
  /**
   * Padding must never exceed the tile. Yoga will not shrink a node below its own padding, so
   * a tile shorter than pad*2 renders at pad*2 regardless of the height set on it — a 0.9px
   * sliver drawn 12px tall, spilling onto whatever sits beneath it. A tile with nothing to
   * show needs no padding at all; one that does gets at most a quarter of its smaller side.
   */
  const pad = hasContent ? Math.min(type.pad, Math.floor(Math.min(tileW, tileH) / 4)) : 0
  const logoSize = compact ? Math.min(14, Math.max(10, tileH - 8)) : Math.min(16, Math.max(12, Math.floor(tileH / 4)))

  const glyph = logoUri && !logo ? (
    <SecurityLogo uri={logoUri} size={logoSize} />
  ) : (
    <AccountGlyph logo={logo} icon={fallbackIcon} size={logoSize} />
  )

  const Container = onPress ? Pressable : View
  return (
    <Container
      onPress={onPress}
      style={{
        position: 'absolute',
        left: x + gapX / 2,
        top: y + gapY / 2,
        width: tileW,
        height: tileH,
        padding: pad,
        backgroundColor: hexToRgba(color, tint),
        // Radius tracks the tile so a 6px sliver isn't rendered as a lozenge.
        borderRadius: Math.min(TILE_RADIUS, tileW / 3, tileH / 3),
        overflow: 'hidden',
        // A ring rather than a colour change: the fill encodes what the tile IS, so selection
        // has to be expressed without overwriting it.
        borderWidth: isSelected ? 1.5 : 0,
        borderColor: textColor,
      }}
    >
      {compact ? (
        <View className="flex-row items-center gap-1.5">
          {showLogo ? glyph : null}
          <Text className="font-sansMed" style={{ color: textColor, opacity: 0.85, fontSize: type.share, fontVariant: ['tabular-nums'] }} numberOfLines={1}>
            {share}
          </Text>
        </View>
      ) : (
        <>
          {/* Logo and name on one line. Stacking them would cost ~16px of height for no gain
              — the name has to ellipsize at this width either way, so it may as well sit
              beside the logo and let the tile be shorter. */}
          <View className="flex-row items-center gap-1.5">
            {showLogo ? glyph : null}
            {showName ? (
              <Text
                className="shrink font-sansSemi"
                style={{ color: textColor, fontSize: type.title }}
                numberOfLines={1}
              >
                {title}
              </Text>
            ) : null}
          </View>
          {showShare ? (
            <Text
              className="font-sansMed"
              style={{ color: textColor, opacity: 0.7, fontSize: type.share, marginTop: 2 }}
              numberOfLines={1}
            >
              {share}
            </Text>
          ) : null}
        </>
      )}
    </Container>
  )
}
