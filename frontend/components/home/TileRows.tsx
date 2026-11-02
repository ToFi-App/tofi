import { View } from 'react-native'
import { CategoryCard } from '@/components/categories/CategoryCard'
import { packRows, type TileState } from '@/lib/home/categoryTiles'

export interface GridTile {
  id: string
  name: string
  icon: string | null
  color: string
  spent: number
  budget: number | null
  state: TileState
  wide: boolean
  onPress: () => void
}

interface TileRowsProps {
  tiles: GridTile[]
  /** One column's width; a wide tile is two of these plus the gap between them. */
  tileWidth: number
  tileHeight: number
  gap: number
}

/** Category tiles packed into rows of three columns (packRows), wide tiles spanning two. */
export function TileRows({ tiles, tileWidth, tileHeight, gap }: TileRowsProps) {
  return (
    <View style={{ gap }}>
      {packRows(tiles).map((row) => (
        <View key={row.map((t) => t.id).join('|')} className="flex-row" style={{ gap }}>
          {row.map((tile) => (
            <CategoryCard
              key={tile.id}
              name={tile.name}
              icon={tile.icon}
              color={tile.color}
              spent={tile.spent}
              budget={tile.budget}
              state={tile.state}
              wide={tile.wide}
              width={tile.wide ? tileWidth * 2 + gap : tileWidth}
              height={tileHeight}
              onPress={tile.onPress}
            />
          ))}
        </View>
      ))}
    </View>
  )
}
