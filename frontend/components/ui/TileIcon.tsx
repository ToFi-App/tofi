import type { ComponentProps } from 'react'
import { View } from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import { hexToRgba } from '@/constants/theme'

const SIZE = 28
const ICON_SIZE = 15

/**
 * The mark at the head of a card on Home's sheet — Budget, Spending, Savings rate: the card's icon in
 * a small round well of a soft tint of its colour, ahead of its title. Kept small enough for the
 * half-width tiles, where the title and the mark have about 140pt between them.
 */
export function TileIcon({ name, color }: { name: ComponentProps<typeof Ionicons>['name']; color: string }) {
  return (
    <View
      className="items-center justify-center rounded-full"
      style={{ width: SIZE, height: SIZE, backgroundColor: hexToRgba(color, 0.12) }}
    >
      <Ionicons name={name} size={ICON_SIZE} color={color} />
    </View>
  )
}
