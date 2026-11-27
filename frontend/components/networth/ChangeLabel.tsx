import { Text, View } from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import { changeColor } from '@/lib/accounts/holdings'

const TABULAR = { fontVariant: ['tabular-nums' as const] }

/**
 * A change in value as the Net Worth tab writes it: a caret pointing the way it moved and the figure
 * beside it, both in gain green or loss red. The caret carries the direction too, so the colour is
 * never the only cue. No change draws no caret, in the secondary text colour.
 */
export function ChangeLabel({ change, text, size = 'sm' }: { change: number | null; text: string; size?: 'xs' | 'sm' }) {
  const color = changeColor(change)
  return (
    <View className="flex-row items-center gap-1">
      {change != null && change !== 0 ? (
        <Ionicons name={change > 0 ? 'caret-up' : 'caret-down'} size={size === 'xs' ? 9 : 11} color={color} />
      ) : null}
      <Text className={size === 'xs' ? 'font-sansSemi text-xs' : 'font-sansSemi text-sm'} style={[TABULAR, { color }]} numberOfLines={1}>
        {text}
      </Text>
    </View>
  )
}
