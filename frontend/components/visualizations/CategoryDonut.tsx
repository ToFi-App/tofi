import { useMemo, type ReactNode } from 'react'
import { Text, View, useWindowDimensions } from 'react-native'
import Svg, { Line, Path } from 'react-native-svg'
import type { DonutSegment } from '@/lib/transactions/visualizationData'
import { CategoryIcon } from '@/components/categories/CategoryIcon'
import { colors, fontFamily } from '@/constants/theme'

interface CategoryDonutProps {
  segments: DonutSegment[]
  highlightedCategoryId?: string | null
  onSegmentPress?: (segment: DonutSegment) => void
  size?: number
  /** Drawn in the ring's hole, e.g. the total the slices add up to. */
  center?: ReactNode
}

function polar(cx: number, cy: number, r: number, deg: number) {
  const rad = ((deg - 90) * Math.PI) / 180
  return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) }
}

function arcPath(cx: number, cy: number, r: number, start: number, end: number) {
  if (end - start >= 359.99) {
    const s = polar(cx, cy, r, start)
    const m = polar(cx, cy, r, start + 180)
    return `M ${s.x} ${s.y} A ${r} ${r} 0 1 1 ${m.x} ${m.y} A ${r} ${r} 0 1 1 ${s.x} ${s.y}`
  }
  const s = polar(cx, cy, r, end)
  const e = polar(cx, cy, r, start)
  const large = end - start > 180 ? 1 : 0
  return `M ${s.x} ${s.y} A ${r} ${r} 0 ${large} 0 ${e.x} ${e.y}`
}

const GAP_DEG = 2
const RING_RATIO = 0.38
const LABEL_MIN_PCT = 3
const LABEL_H = 20
/** How far past the ring a slice label's leader line reaches, before the label itself. */
const LABEL_REACH = 22

export function CategoryDonut({ segments, highlightedCategoryId, onSegmentPress, size: sizeProp, center }: CategoryDonutProps) {
  const { width } = useWindowDimensions()
  const size = sizeProp ?? Math.min(width - 16, 320)
  const outerR = size * 0.28
  const ringW = outerR * RING_RATIO
  const midR = outerR - ringW / 2
  const hasHighlight = highlightedCategoryId != null
  // `size` is the width the side labels need. Vertically only the labels above and below the ring
  // need room, so the box is cut to that instead of left square with empty bands top and bottom.
  const height = Math.min(size, 2 * (hasHighlight ? outerR + 2 : outerR + LABEL_REACH + LABEL_H / 2 + 2))
  const cx = size / 2
  const cy = height / 2
  const holeR = outerR - ringW

  const arcs = useMemo(() => {
    // Zero-amount segments are listed (a category whose rows are all excluded still gets a card and
    // a breakdown row) but have no arc to draw. Dropped before the gaps are apportioned: each one
    // left in would still claim a GAP_DEG of the ring and shrink every real slice around an
    // invisible sliver.
    const drawable = segments.filter((seg) => seg.percentage > 0)
    if (drawable.length === 0) return []
    const gap = drawable.length > 1 ? GAP_DEG : 0
    const available = 360 - gap * drawable.length
    let angle = 0
    return drawable.map((seg) => {
      const sweep = (seg.percentage / 100) * available
      const start = angle
      const end = angle + sweep
      const mid = start + sweep / 2
      angle = end + gap
      return { ...seg, start, end, mid, path: arcPath(cx, cy, midR, start, end) }
    })
  }, [segments, cx, cy, midR])

  const labels = useMemo(
    () =>
      hasHighlight
        ? []
        : arcs
            .filter((a) => a.percentage >= LABEL_MIN_PCT)
            .map((arc) => {
              const start = polar(cx, cy, outerR + 4, arc.mid)
              const knee = polar(cx, cy, outerR + LABEL_REACH, arc.mid)
              const isRight = arc.mid > 0 && arc.mid < 180
              const endX = isRight ? knee.x + 20 : knee.x - 20
              return { ...arc, start, knee, endX, isRight }
            }),
    [arcs, hasHighlight, cx, cy, outerR],
  )

  // Nothing drawable means nothing counted, even if zero-amount segments were passed in for the
  // breakdown list below the chart. Render nothing rather than an empty ring-sized hole.
  if (arcs.length === 0) return null

  return (
    <View style={{ alignItems: 'center' }}>
      <View style={{ width: size, height }}>
        <Svg width={size} height={height}>
          {arcs.map((arc) => {
            const opacity = hasHighlight ? (arc.categoryId === highlightedCategoryId ? 1 : 0.15) : 1
            return (
              <Path
                key={arc.categoryId}
                d={arc.path}
                stroke={arc.color}
                strokeWidth={ringW}
                fill="none"
                strokeLinecap="butt"
                opacity={opacity}
                onPress={onSegmentPress ? () => onSegmentPress(arc) : undefined}
              />
            )
          })}

          {labels.map((l) => (
            <Line
              key={`line-${l.categoryId}`}
              x1={l.start.x}
              y1={l.start.y}
              x2={l.knee.x}
              y2={l.knee.y}
              stroke={colors.textMuted}
              strokeWidth={1}
            />
          ))}
          {labels.map((l) => (
            <Line
              key={`hz-${l.categoryId}`}
              x1={l.knee.x}
              y1={l.knee.y}
              x2={l.endX}
              y2={l.knee.y}
              stroke={colors.textMuted}
              strokeWidth={1}
            />
          ))}
        </Svg>

        {labels.map((l) => (
          <View
            key={`lbl-${l.categoryId}`}
            style={{
              position: 'absolute',
              top: l.knee.y - LABEL_H / 2,
              ...(l.isRight
                ? { left: l.endX + 4 }
                : { right: size - l.endX + 4 }),
              flexDirection: 'row',
              alignItems: 'center',
              gap: 3,
              height: LABEL_H,
            }}
          >
            {l.isRight ? (
              <>
                <Text style={{ fontFamily: fontFamily.mono, fontSize: 11, color: colors.textSecondary }}>
                  {Math.round(l.percentage)}%
                </Text>
                <CategoryIcon icon={l.icon} size={13} color={l.color} />
              </>
            ) : (
              <>
                <CategoryIcon icon={l.icon} size={13} color={l.color} />
                <Text style={{ fontFamily: fontFamily.mono, fontSize: 11, color: colors.textSecondary }}>
                  {Math.round(l.percentage)}%
                </Text>
              </>
            )}
          </View>
        ))}

        {center != null ? (
          <View
            pointerEvents="none"
            style={{ position: 'absolute', left: cx - holeR, top: cy - holeR, width: holeR * 2, height: holeR * 2, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 6 }}
          >
            {center}
          </View>
        ) : null}
      </View>
    </View>
  )
}
