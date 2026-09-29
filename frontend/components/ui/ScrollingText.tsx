import { useState } from 'react'
import { Pressable, ScrollView, Text, View, type PressableProps, type StyleProp, type TextStyle, type ViewStyle } from 'react-native'
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg'
import { colors } from '@/constants/theme'

const FADE_WIDTH = 28

/** A strip that fades from the background to transparent, laid over one end of the text. */
function EdgeFade({ side, color }: { side: 'left' | 'right'; color: string }) {
  // Opaque at the outer edge, clear toward the text.
  const [from, to] = side === 'right' ? [0, 1] : [1, 0]
  return (
    <View pointerEvents="none" style={{ position: 'absolute', top: 0, bottom: 0, [side]: 0, width: FADE_WIDTH }}>
      <Svg width="100%" height="100%">
        <Defs>
          <LinearGradient id={`scrolling-text-fade-${side}`} x1="0" y1="0" x2="1" y2="0">
            <Stop offset="0" stopColor={color} stopOpacity={from} />
            <Stop offset="1" stopColor={color} stopOpacity={to} />
          </LinearGradient>
        </Defs>
        <Rect x="0" y="0" width="100%" height="100%" fill={`url(#scrolling-text-fade-${side})`} />
      </Svg>
    </View>
  )
}

interface ScrollingTextProps {
  children: string
  className?: string
  textStyle?: StyleProp<TextStyle>
  /** For a scroller that needs a fixed height to lay out against. */
  style?: StyleProp<ViewStyle>
  /** The tap and long-press handlers of the row this text sits in — see below for why. */
  pressProps?: PressableProps
  /**
   * The solid colour behind the text, which the fades are painted in. It has to match: a fade in
   * any other colour shows as a box at the end of the text.
   */
  fadeColor?: string
}

/**
 * One line of text that scrolls sideways rather than being cut off, fading at whichever end has
 * more to see — the cue that it scrolls at all. Text that fits draws no fade.
 *

 * The fade is an overlay painted in `fadeColor`, not a mask: masking the text would need a native
 * module, which means a new build and App Store review rather than an over-the-air update.
 *
 * A scroll view nested in a Pressable never scrolls on its own: the outer Pressable takes the touch
 * and the scroll view can't get it back. So the text carries its own Pressable, with the row's
 * handlers passed in, which hands the touch over as soon as the finger moves sideways.
 */
export function ScrollingText({ children, className, textStyle, style, pressProps, fadeColor = colors.surface }: ScrollingTextProps) {
  const [viewWidth, setViewWidth] = useState(0)
  const [contentWidth, setContentWidth] = useState(0)
  const [offset, setOffset] = useState(0)
  // A pixel of slack, so rounding in layout never leaves a fade over text that fits.
  const overflows = viewWidth > 0 && contentWidth - viewWidth > 1
  const moreRight = overflows && contentWidth - viewWidth - offset > 1
  const moreLeft = overflows && offset > 1

  return (
    <View>
      {/* flexGrow 0: a ScrollView grows to fill its parent by default, which pins the text to the
          top of its row instead of centring it. */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        directionalLockEnabled
        nestedScrollEnabled
        style={[{ flexGrow: 0 }, style]}
        contentContainerStyle={{ alignItems: 'center' }}
        onLayout={(e) => setViewWidth(e.nativeEvent.layout.width)}
        onContentSizeChange={(width) => setContentWidth(width)}
        onScroll={(e) => setOffset(e.nativeEvent.contentOffset.x)}
        scrollEventThrottle={16}
      >
        <Pressable {...pressProps}>
          {/* flexShrink 0: left to shrink, the text is squeezed to the scroll view's width and
              truncated, and there is nothing left to scroll. */}
          <Text className={className} numberOfLines={1} style={[{ flexShrink: 0 }, textStyle]}>
            {children}
          </Text>
        </Pressable>
      </ScrollView>
      {moreLeft ? <EdgeFade side="left" color={fadeColor} /> : null}
      {moreRight ? <EdgeFade side="right" color={fadeColor} /> : null}
    </View>
  )
}
