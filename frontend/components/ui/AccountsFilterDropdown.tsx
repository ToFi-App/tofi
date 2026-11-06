import { Ionicons } from '@expo/vector-icons'
import { useState } from 'react'
import { Pressable, ScrollView, Text, View } from 'react-native'
import { WalletCards } from 'lucide-react-native'
import { colors, heroGradient } from '@/constants/theme'
import { BottomSheet } from './BottomSheet'
import { GlassButton } from './GlassButton'
import type { Account } from '@/types/domain'

interface AccountsFilterDropdownProps {
  accounts: Account[]
  selectedAccountId: string | null
  onSelect: (accountId: string | null) => void
  /** 'icon' is a wallet-and-cards glyph for a crowded header — it picks which accounts are shown —
   *  with a dot on it while one is picked, so a narrowed view never goes unnoticed. Defaults to the
   *  account's name with a chevron. 'glass' is the same glyph in a round glass button, for
   *  Home's header on its mint top section. */
  variant?: 'inline' | 'icon' | 'glass'
  /** 'inverse' draws the icon white, for a header on the brand colour. Icon variant only. */
  tone?: 'default' | 'inverse'
}

export function AccountsFilterDropdown({
  accounts,
  selectedAccountId,
  onSelect,
  variant = 'inline',
  tone = 'default',
}: AccountsFilterDropdownProps) {
  const [isOpen, setIsOpen] = useState(false)
  const selectedName = selectedAccountId
    ? accounts.find((a) => a.account_id === selectedAccountId)?.name ?? 'All'
    : 'All'

  const triggerLabel = selectedAccountId ? `Showing ${selectedName}. Choose account` : 'Showing all accounts. Choose account'
  const isInverse = tone === 'inverse'
  // Ink for the glyph: white on the brand colour, the mint's deep teal on Home's glass button, dark
  // text on a plain light header.
  const ink = isInverse ? colors.textInverse : variant === 'glass' ? heroGradient.ink : colors.textPrimary
  // Lucide draws outlines only, so a narrowed view is marked with a dot rather than a filled glyph:
  // brand teal on a light header, white ringed in teal on the teal one.
  const glyph = (
    <View>
      <WalletCards size={variant === 'glass' ? 18 : 22} strokeWidth={2} color={ink} />
      {selectedAccountId ? (
        <View
          style={{
            position: 'absolute',
            top: -2,
            right: -3,
            width: 9,
            height: 9,
            borderRadius: 4.5,
            borderWidth: 1.5,
            borderColor: isInverse ? colors.primary : colors.background,
            backgroundColor: isInverse ? colors.textInverse : colors.primary,
          }}
        />
      ) : null}
    </View>
  )

  return (
    <>
      {variant === 'glass' ? (
        <GlassButton onPress={() => setIsOpen(true)} accessibilityLabel={triggerLabel}>
          {glyph}
        </GlassButton>
      ) : variant === 'icon' ? (
        <Pressable onPress={() => setIsOpen(true)} hitSlop={8} accessibilityRole="button" accessibilityLabel={triggerLabel}>
          {glyph}
        </Pressable>
      ) : (
        <Pressable onPress={() => setIsOpen(true)} className="flex-row items-center gap-1">
          <Text className="font-sansSemi text-base text-primary">{selectedName.length > 8 ? selectedName.slice(0, 8) + '…' : selectedName}</Text>
          <Ionicons name="chevron-down" size={14} color={colors.primary} />
        </Pressable>
      )}

      <BottomSheet visible={isOpen} onClose={() => setIsOpen(false)}>
        <View className="flex-row items-center justify-between px-5 py-3">
          <Pressable onPress={() => setIsOpen(false)} hitSlop={8}>
            <Ionicons name="close" size={22} color={colors.textSecondary} />
          </Pressable>
          <Text className="font-display text-md text-textPrimary">Select Account</Text>
          <View style={{ width: 22 }} />
        </View>

        <ScrollView className="px-5">
          <Pressable
            onPress={() => {
              onSelect(null)
              setIsOpen(false)
            }}
            className="flex-row items-center justify-between py-4 border-b"
            style={{ borderColor: colors.border }}
          >
            <Text className="font-sansMed text-base text-textPrimary">All</Text>
            {selectedAccountId === null ? <Ionicons name="checkmark-circle" size={20} color={colors.primary} /> : null}
          </Pressable>
          {accounts.map((account) => (
            <Pressable
              key={account.account_id}
              onPress={() => {
                onSelect(account.account_id)
                setIsOpen(false)
              }}
              className="flex-row items-center justify-between py-4 border-b"
              style={{ borderColor: colors.border }}
            >
              <Text className="font-sansMed text-base text-textPrimary">{account.name}</Text>
              {selectedAccountId === account.account_id ? (
                <Ionicons name="checkmark-circle" size={20} color={colors.primary} />
              ) : null}
            </Pressable>
          ))}
        </ScrollView>
      </BottomSheet>
    </>
  )
}
