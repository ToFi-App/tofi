import { Text, View } from 'react-native'
import { SlidersHorizontal } from 'lucide-react-native'
import { colors } from '@/constants/theme'
import { GlassButton } from '@/components/ui/GlassButton'
import { useHeroInk } from '@/components/ui/HeroGlass'

/** The Calendar header's filter button: a glass button like its neighbours, badged with how many sections are narrowing the month. */
export function CalendarFilterButton({ activeCount, onPress }: { activeCount: number; onPress: () => void }) {
  const ink = useHeroInk()
  return (
    <View>
      <GlassButton
        onPress={onPress}
        accessibilityLabel={activeCount > 0 ? `Filter, ${activeCount} active` : 'Filter transactions'}
      >
        <SlidersHorizontal size={18} strokeWidth={2} color={ink} />
      </GlassButton>
      {activeCount > 0 ? (
        <View
          pointerEvents="none"
          className="absolute items-center justify-center rounded-full"
          style={{ top: -3, right: -3, minWidth: 18, height: 18, paddingHorizontal: 4, backgroundColor: colors.primary }}
        >
          <Text className="font-sansSemi text-textInverse" style={{ fontSize: 11 }}>
            {activeCount}
          </Text>
        </View>
      ) : null}
    </View>
  )
}
