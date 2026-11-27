import { Dimensions, Modal, Pressable, Text, View } from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import { SquarePen } from 'lucide-react-native'
import { colors, hexToRgba, shadow } from '@/constants/theme'
import type { WriteAnchor } from '@/components/home/HomeHeader'
import { haptics } from '@/lib/ui/haptics'

const MENU_WIDTH = 272
const SCREEN_MARGIN = 20

/**
 * The Calendar "+" menu: New transaction, or New group. An anchored card under the button rather
 * than a bottom sheet, for the same reason the month picker is one — choosing what to create is a
 * passing menu, not a task. Built on MonthNavigator's popover: transparent Modal, tap outside to
 * dismiss, card clamped to the screen edge.
 */
export function CreateMenu({
  anchor,
  showNewBadge,
  onClose,
  onNewTransaction,
  onNewGroup,
}: {
  /** The "+" button's frame; null while closed. */
  anchor: WriteAnchor | null
  /** The NEW tag on "New group", shown until the menu has been opened once. */
  showNewBadge: boolean
  onClose: () => void
  onNewTransaction: () => void
  onNewGroup: () => void
}) {
  const screenWidth = Dimensions.get('window').width
  const left = anchor
    ? Math.min(Math.max(anchor.x + anchor.width - MENU_WIDTH, SCREEN_MARGIN), screenWidth - MENU_WIDTH - SCREEN_MARGIN)
    : 0
  const top = anchor ? anchor.y + anchor.height + 8 : 0

  return (
    <Modal transparent visible={anchor != null} animationType="fade" onRequestClose={onClose}>
      <Pressable style={{ flex: 1 }} onPress={onClose} accessibilityLabel="Dismiss menu">
        {anchor ? (
          <Pressable
            onPress={() => {}}
            accessibilityRole="menu"
            style={[
              {
                position: 'absolute',
                left,
                top,
                width: MENU_WIDTH,
                backgroundColor: colors.surface,
                borderRadius: 16,
                borderWidth: 1,
                borderColor: colors.border,
                padding: 6,
              },
              shadow.md,
            ]}
          >
            <MenuItem
              icon={<SquarePen size={18} strokeWidth={2} color={colors.textPrimary} />}
              iconBg={colors.surfaceRaised}
              title="New transaction"
              onPress={onNewTransaction}
            />
            <MenuItem
              icon={<Ionicons name="albums-outline" size={18} color={colors.primary} />}
              iconBg={colors.primaryMuted}
              title="New group"
              subtitle="Keep a trip's spending and paybacks together"
              badge={showNewBadge}
              onPress={onNewGroup}
            />
          </Pressable>
        ) : null}
      </Pressable>
    </Modal>
  )
}

function MenuItem({
  icon,
  iconBg,
  title,
  subtitle,
  badge = false,
  onPress,
}: {
  icon: React.ReactNode
  iconBg: string
  title: string
  subtitle?: string
  badge?: boolean
  onPress: () => void
}) {
  return (
    <Pressable
      onPress={() => {
        haptics.tap()
        onPress()
      }}
      accessibilityRole="menuitem"
      className="flex-row items-center gap-3 rounded-md px-2.5 py-2.5 active:opacity-70"
      style={{ minHeight: 52 }}
    >
      <View className="h-9 w-9 items-center justify-center rounded-md" style={{ backgroundColor: iconBg }}>
        {icon}
      </View>
      <View className="flex-1 gap-0.5">
        <View className="flex-row items-center gap-1.5">
          <Text className="font-sansMed text-base text-textPrimary">{title}</Text>
          {badge ? (
            <View className="rounded-full px-1.5 py-0.5" style={{ backgroundColor: hexToRgba(colors.primary, 0.14) }}>
              <Text className="font-sansSemi text-xs text-primary">New</Text>
            </View>
          ) : null}
        </View>
        {subtitle ? <Text className="font-sans text-sm text-textSecondary">{subtitle}</Text> : null}
      </View>
    </Pressable>
  )
}
