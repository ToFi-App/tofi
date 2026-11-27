import { useMMKVBoolean } from 'react-native-mmkv'
import { GROUPS_MENU_SEEN_KEY, preferences } from '@/lib/storage/preferences'

// The Calendar "+" button carries a small dot until the user first opens its menu, which is how
// they learn it now holds "New group" too (docs/transaction-groups.md §4). Device-local, like the
// other display preferences: seeing it on one phone says nothing about another.
export function useGroupsMenuSeen(): { seen: boolean; markSeen: () => void } {
  const [seen, setSeen] = useMMKVBoolean(GROUPS_MENU_SEEN_KEY, preferences)
  return { seen: seen ?? false, markSeen: () => setSeen(true) }
}
