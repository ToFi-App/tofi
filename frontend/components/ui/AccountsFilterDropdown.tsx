import { Ionicons } from '@expo/vector-icons'
import { useState } from 'react'
import { Pressable, ScrollView, Text, View } from 'react-native'
import { WalletCards } from 'lucide-react-native'
import { colors } from '@/constants/theme'
import { BottomSheet } from './BottomSheet'
import { GlassButton } from './GlassButton'
import { useHeroInk } from './HeroGlass'
import { AccountIcon } from '@/components/accounts/AccountRow'
import { isInvestmentAccount, isLiabilityAccount } from '@/lib/accounts/accountType'
import type { Account } from '@/types/domain'

interface AccountsFilterDropdownProps {
  accounts: Account[]
  selectedAccountId: string | null
  onSelect: (accountId: string | null) => void
  /** 'icon' is a wallet-and-cards glyph for a crowded header — it picks which accounts are shown —
   *  replaced by the picked account's own bank logo while one is picked, so a narrowed view never
   *  goes unnoticed. Defaults to the
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
  const selectedAccount = selectedAccountId ? accounts.find((a) => a.account_id === selectedAccountId) : undefined
  const selectedName = selectedAccount?.name ?? 'All'

  const triggerLabel = selectedAccountId ? `Showing ${selectedName}. Choose account` : 'Showing all accounts. Choose account'
  const isInverse = tone === 'inverse'
  const heroInk = useHeroInk()
  // Ink for the glyph: white on the brand colour, the mint's deep teal on Home's glass button, dark
  // text on a plain light header.
  const ink = isInverse ? colors.textInverse : variant === 'glass' ? heroInk : colors.textPrimary
  // Narrowed to one account, the button shows that account — its bank's logo, or its fallback glyph —
  // so which account the screen is showing is plain at a glance. Showing everything, the
  // wallet-and-cards glyph.
  const glyph = selectedAccount ? (
    <AccountIcon
      logo={selectedAccount.institutionLogo}
      variant={accountVariant(selectedAccount)}
      itemId={selectedAccount.itemId}
      size={variant === 'glass' ? 22 : 24}
    />
  ) : (
    <View>
      <WalletCards size={variant === 'glass' ? 18 : 22} strokeWidth={2} color={ink} />
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
            <View className="flex-row items-center gap-3">
              {/* Every account at once: a stack of cards in the same tile the fallback glyphs use. */}
              <View className="items-center justify-center rounded-sm" style={{ width: 28, height: 28, backgroundColor: colors.primaryMuted }}>
                <Ionicons name="albums" size={15} color={colors.primary} />
              </View>
              <Text className="font-sansMed text-base text-textPrimary">All</Text>
            </View>
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
              {/* The account's bank logo, or its fallback glyph — the same mark it has in the accounts list. */}
              <View className="flex-1 flex-row items-center gap-3">
                <AccountIcon logo={account.institutionLogo} variant={accountVariant(account)} itemId={account.itemId} />
                <Text className="flex-1 font-sansMed text-base text-textPrimary" numberOfLines={1}>
                  {account.name}
                </Text>
              </View>
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

/** Which fallback glyph an account takes when it has no logo — the accounts list's own grouping. */
function accountVariant(account: Account): 'credit' | 'investment' | 'cash' {
  if (isLiabilityAccount(account)) return 'credit'
  if (isInvestmentAccount(account)) return 'investment'
  return 'cash'
}
