import { Pressable, View } from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import { GlassView, isLiquidGlassAvailable } from 'expo-glass-effect'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { borderRadius, colors } from '@/constants/theme'

// Fixed for the life of the process: it depends on the OS and the SDK the binary was built with.
const HAS_LIQUID_GLASS = isLiquidGlassAvailable()

interface ViewTogglePillProps {
  vizMode: boolean
  onToggle: () => void
}

export function ViewTogglePill({ vizMode, onToggle }: ViewTogglePillProps) {
  // Inside a native tab the bottom inset includes the floating tab bar, so this sits just above it.
  const insets = useSafeAreaInsets()

  const trackStyle = {
    flexDirection: 'row',
    borderRadius: borderRadius.full,
    padding: 3,
    gap: 2,
  } as const

  const segments = (
    <>
      <Pressable
        onPress={vizMode ? onToggle : undefined}
        accessibilityRole="button"
        accessibilityLabel="Grid view"
        accessibilityState={{ selected: !vizMode }}
        style={{
          width: 56,
          height: 24,
          borderRadius: borderRadius.full,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: !vizMode ? colors.primaryMuted : 'transparent',
        }}
      >
        <Ionicons name="apps" size={14} color={!vizMode ? colors.primary : colors.textMuted} />
      </Pressable>
      <Pressable
        onPress={vizMode ? undefined : onToggle}
        accessibilityRole="button"
        accessibilityLabel="Chart view"
        accessibilityState={{ selected: vizMode }}
        style={{
          width: 56,
          height: 24,
          borderRadius: borderRadius.full,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: vizMode ? colors.primaryMuted : 'transparent',
        }}
      >
        <Ionicons name="pie-chart" size={14} color={vizMode ? colors.primary : colors.textMuted} />
      </Pressable>
    </>
  )

  return (
    <View
      pointerEvents="box-none"
      style={{
        position: 'absolute',
        bottom: insets.bottom,
        left: 0,
        right: 0,
        backgroundColor: 'transparent',
        alignItems: 'center',
        paddingVertical: 6,
      }}
    >
      {/* Glass to match the tab bar it floats over; the solid track is the pre-iOS 26 fallback. */}
      {HAS_LIQUID_GLASS ? (
        <GlassView isInteractive style={trackStyle}>
          {segments}
        </GlassView>
      ) : (
        <View style={[trackStyle, { backgroundColor: colors.surfaceRaised }]}>{segments}</View>
      )}
    </View>
  )
}
