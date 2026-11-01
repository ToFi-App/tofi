import { Ionicons } from '@expo/vector-icons'
import { useState } from 'react'
import { Pressable, ScrollView, Text, View } from 'react-native'
import { colors } from '@/constants/theme'
import { BottomSheet } from './BottomSheet'
import type { Account } from '@/types/domain'

interface AccountsFilterDropdownProps {
  accounts: Account[]
  selectedAccountId: string | null
  onSelect: (accountId: string | null) => void
  /** 'icon' is a filter glyph for a crowded header: outlined while every account is shown, filled in
   *  the brand colour while one is picked, so a narrowed view never goes unnoticed. Defaults to the
   *  account's name with a chevron. */
  variant?: 'inline' | 'icon'
}

export function AccountsFilterDropdown({ accounts, selectedAccountId, onSelect, variant = 'inline' }: AccountsFilterDropdownProps) {
  const [isOpen, setIsOpen] = useState(false)
  const selectedName = selectedAccountId
    ? accounts.find((a) => a.account_id === selectedAccountId)?.name ?? 'All'
    : 'All'

  return (
    <>
      {variant === 'icon' ? (
        <Pressable
          onPress={() => setIsOpen(true)}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel={selectedAccountId ? `Showing ${selectedName}. Choose account` : 'Showing all accounts. Choose account'}
        >
          <Ionicons
            name={selectedAccountId ? 'funnel' : 'funnel-outline'}
            size={21}
            color={selectedAccountId ? colors.primary : colors.textPrimary}
          />
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
