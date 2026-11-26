import { View } from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import { hexToRgba } from '@/constants/theme'
import { CategoryIcon } from '@/components/categories/CategoryIcon'

/**
 * A group's badge: its colour as a tinted rounded square (rounded, not round, so a group never
 * reads as a category's circle in the same list) holding its icon. A group created from the "+"
 * menu has no icon yet, so it shows the generic group glyph.
 */
export function GroupIcon({ color, icon, size = 40 }: { color: string; icon: string | null; size?: number }) {
  const glyph = Math.round(size * 0.45)
  return (
    <View
      className="items-center justify-center"
      style={{ width: size, height: size, borderRadius: Math.round(size * 0.3), backgroundColor: hexToRgba(color, 0.18) }}
    >
      {icon ? <CategoryIcon icon={icon} size={glyph} color={color} /> : <Ionicons name="albums-outline" size={glyph} color={color} />}
    </View>
  )
}
