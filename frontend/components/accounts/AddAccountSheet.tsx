import type { ReactNode } from 'react'
import { Image, Pressable, ScrollView, Text, View } from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import { borderRadius, colors, shadow } from '@/constants/theme'
import { BottomSheet, useSheetScroll } from '@/components/ui/BottomSheet'
import type { Institution } from '@/types/domain'

/** A row's logo or glyph well. */
const MARK_SIZE = 36

/** A group's heading: dark and in sentence case, a step under the row titles, not grey capitals. */
function SectionHeading({ children, isFirst = true }: { children: ReactNode; isFirst?: boolean }) {
  return <Text className={`font-sansSemi text-sm text-textPrimary ${isFirst ? 'pt-1' : 'pt-4'}`}>{children}</Text>
}

/** The round well a glyph sits in when there is no logo. */
function MarkWell({ children, tint = colors.surfaceRaised }: { children: ReactNode; tint?: string }) {
  return (
    <View style={{ width: MARK_SIZE, height: MARK_SIZE, borderRadius: MARK_SIZE / 2, backgroundColor: tint }} className="items-center justify-center">
      {children}
    </View>
  )
}

/**
 * One choice, on a card of its own — white, rounded, lightly shadowed, as Home's categories and the
 * investment accounts are laid out — so on the white sheet each reads as something to tap rather
 * than a line of text.
 */
function SheetRow({
  onPress,
  accessibilityLabel,
  mark,
  title,
  subtitle,
}: {
  onPress: () => void
  accessibilityLabel: string
  mark: ReactNode
  title: string
  subtitle?: string
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      style={[shadow.sm, { borderRadius: borderRadius.xl, backgroundColor: colors.surface }]}
      className="flex-row items-center gap-3 px-4 py-3"
    >
      {mark}
      <View className="flex-1 gap-0.5">
        <Text className="font-sansSemi text-base text-textPrimary">{title}</Text>
        {subtitle ? <Text className="font-sans text-sm text-textPrimary">{subtitle}</Text> : null}
      </View>
      <Ionicons name="chevron-forward" size={18} color={colors.textSecondary} />
    </Pressable>
  )
}

interface AddAccountSheetProps {
  visible: boolean
  onClose: () => void
  institutions: Institution[]
  /** Institution logos live on account rows, not on the institution record. */
  logoByItemId: Map<string, string | null>
  onManageInstitution: (itemId: string) => void
  onConnectNewBank: () => void
  /**
   * Apple Card / Cash / Savings via FinanceKit. Optional so the sheet stays usable without it.
   * `visible` is false on devices that cannot serve FinanceKit data at all, in which case the row
   * is not rendered rather than rendered disabled — there is nothing the user could do about it.
   */
  appleAccounts?: {
    visible: boolean
    isConnected: boolean
    onConnect: () => void
  }
}

/**
 * One list instead of a "new card or new bank?" question. The user points at the bank they mean
 * and the Link mode follows from what they tapped — an existing bank opens update mode (free,
 * reuses the stored access token), the last row opens create mode (spends a Plaid connection).
 *
 * That framing is the whole point: Plaid decides create-vs-update when the link token is minted,
 * before Link opens, and the institution is chosen inside Plaid's own UI. So the app cannot
 * notice "they already have Chase" after the fact — by then the Item exists. Asking first, in the
 * user's own terms, is what keeps a second Item from being created for a bank already connected.
 */
export function AddAccountSheet({
  visible,
  onClose,
  institutions,
  logoByItemId,
  onManageInstitution,
  onConnectNewBank,
  appleAccounts,
}: AddAccountSheetProps) {
  const sheetScroll = useSheetScroll()

  return (
    <BottomSheet visible={visible} onClose={onClose} contentScroll={sheetScroll}>
      <View className="px-5 pb-2 pt-1">
        <Text className="font-sansSemi text-lg text-textPrimary">Add an account</Text>
      </View>

      <ScrollView {...sheetScroll.scrollProps} contentContainerClassName="gap-2.5 px-5 pb-6">
        {/* Every bank row did the same thing, so its subtitle said the same thing six times: the
            heading says it once instead. */}
        {institutions.length > 0 ? <SectionHeading>Share more from a bank you've connected</SectionHeading> : null}

        {institutions.map((institution) => {
          const logo = logoByItemId.get(institution.itemId) ?? null
          return (
            <SheetRow
              key={institution.itemId}
              onPress={() => onManageInstitution(institution.itemId)}
              accessibilityLabel={`Choose accounts at ${institution.institutionName}`}
              mark={
                logo ? (
                  <Image source={{ uri: `data:image/png;base64,${logo}` }} style={{ width: MARK_SIZE, height: MARK_SIZE, borderRadius: MARK_SIZE / 2 }} />
                ) : (
                  <MarkWell>
                    <Ionicons name="business" size={18} color={colors.textSecondary} />
                  </MarkWell>
                )
              }
              title={institution.institutionName}
            />
          )
        })}

        <SectionHeading isFirst={institutions.length === 0}>Somewhere else</SectionHeading>

        {appleAccounts?.visible ? (
          <SheetRow
            onPress={appleAccounts.onConnect}
            accessibilityLabel="Add Apple Card, Apple Cash and Savings"
            mark={
              <MarkWell>
                <Ionicons name="logo-apple" size={18} color={colors.textPrimary} />
              </MarkWell>
            }
            title="Apple Card, Cash & Savings"
            // The contrast with the row below is the point: this one reads Wallet on the device, so
            // it costs no Plaid connection and sends nothing to a server.
            subtitle={appleAccounts.isConnected ? 'Connected, reads Wallet on this iPhone' : 'Reads Wallet on this iPhone'}
          />
        ) : null}
        <SheetRow
          onPress={onConnectNewBank}
          accessibilityLabel="Connect a new bank"
          mark={
            <MarkWell tint={colors.primaryMuted}>
              <Ionicons name="add" size={20} color={colors.primary} />
            </MarkWell>
          }
          title="Connect a new bank"
          // The cost is stated on the only row that carries it.
          subtitle="Uses one of your Plaid connections"
        />
      </ScrollView>
    </BottomSheet>
  )
}
