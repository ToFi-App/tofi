import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { Pressable, ScrollView, Text, TextInput, View } from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { borderRadius, colors, fontFamily, fontSize } from '@/constants/theme'
import { BottomSheet } from '@/components/ui/BottomSheet'
import { SheetHeader } from '@/components/ui/SheetHeader'
import { Button } from '@/components/ui/Button'
import { RangeSlider } from '@/components/ui/RangeSlider'
import { CategoryIcon } from '@/components/categories/CategoryIcon'
import {
  applyCalendarFilter,
  EMPTY_CALENDAR_FILTER,
  type CalendarFilter,
  type FilterFlag,
  type FilterKind,
} from '@/lib/transactions/calendarFilter'
import { amountToPosition, niceCeiling, positionToAmount } from '@/lib/ui/amountScale'
import type { FeedItem } from '@/lib/transactions/resolveFeed'
import type { Category, Subcategory } from '@/types/domain'

const KINDS: {
  kind: FilterKind
  label: string
  icon: keyof typeof Ionicons.glyphMap
  color: string
}[] = [
  {
    kind: 'income',
    label: 'Income',
    icon: 'arrow-down-circle',
    color: colors.income,
  },
  {
    kind: 'expense',
    label: 'Expense',
    icon: 'arrow-up-circle',
    color: colors.expense,
  },
  {
    kind: 'transfer',
    label: 'Transfer',
    icon: 'swap-horizontal',
    color: colors.primary,
  },
]

const FLAGS: {
  flag: FilterFlag
  label: string
  icon: keyof typeof Ionicons.glyphMap
}[] = [
  { flag: 'reimbursed', label: 'Reimbursed', icon: 'return-down-back' },
  { flag: 'pending', label: 'Pending', icon: 'time-outline' },
  { flag: 'notCounted', label: "Doesn't count", icon: 'eye-off-outline' },
]

interface CalendarFilterSheetProps {
  visible: boolean
  onClose: () => void
  filter: CalendarFilter
  onApply: (filter: CalendarFilter) => void
  /** Every month's rows (narrowed by the account filter), before this filter: the result count and
   *  the amount range are drawn from these, since the filter outlives the month being viewed. */
  feed: FeedItem[]
  categoryById: Map<string, Category>
  subcategories: Subcategory[]
}

/**
 * The Calendar tab's filter. It isn't tied to the month on screen: set it once, then step through
 * the months with it on. So every category is offered, and the "Show" button counts matches across
 * all months. Choices are a draft until "Show" applies them.
 */
export function CalendarFilterSheet({
  visible,
  onClose,
  filter,
  onApply,
  feed,
  categoryById,
  subcategories,
}: CalendarFilterSheetProps) {
  const insets = useSafeAreaInsets()
  const [draft, setDraft] = useState(filter)

  // Each opening starts from what's applied: closing without "Show" discards the draft.
  useEffect(() => {
    if (visible) setDraft(filter)
  }, [visible, filter])

  const matchCount = useMemo(() => applyCalendarFilter(feed, draft).length, [feed, draft])

  const categoryChoices = useMemo(() => [...categoryById.values()].sort((a, b) => a.name.localeCompare(b.name)), [categoryById])

  // Subcategories of the picked categories, grouped under them.
  const subcategoryGroups = useMemo(
    () =>
      draft.categoryIds
        .filter((id): id is string => id != null)
        .map((id) => ({
          category: categoryById.get(id),
          subs: subcategories.filter((sub) => sub.categoryId === id),
        }))
        .filter((group) => group.category && group.subs.length > 0),
    [draft.categoryIds, subcategories, categoryById],
  )

  const amountCeiling = useMemo(() => niceCeiling(feed.reduce((max, item) => Math.max(max, Math.abs(item.amount)), 0)), [feed])
  const low = draft.amountMin ?? 0
  const high = draft.amountMax ?? amountCeiling

  function toggle<T>(list: T[], value: T): T[] {
    return list.includes(value) ? list.filter((v) => v !== value) : [...list, value]
  }

  function toggleCategory(id: string | null) {
    const categoryIds = toggle(draft.categoryIds, id)
    // Unpicking a category drops its subcategories with it.
    const subs = categoryIds.includes(id) ? draft.subcategories : draft.subcategories.filter((sub) => sub.categoryId !== id)
    setDraft({ ...draft, categoryIds, subcategories: subs })
  }

  function toggleSubcategory(sub: Subcategory) {
    const picked = draft.subcategories.some((s) => s.id === sub.id)
    setDraft({
      ...draft,
      subcategories: picked
        ? draft.subcategories.filter((s) => s.id !== sub.id)
        : [...draft.subcategories, { id: sub.id, categoryId: sub.categoryId }],
    })
  }

  function setAmountRange(lowPos: number, highPos: number) {
    const min = positionToAmount(lowPos, amountCeiling)
    const max = positionToAmount(highPos, amountCeiling)
    setDraft((current) => ({
      ...current,
      amountMin: min <= 0 ? null : min,
      // At the top of the track there's no upper bound, so a bigger row added later still shows.
      amountMax: max >= amountCeiling ? null : max,
    }))
  }

  function apply() {
    onApply(draft)
    onClose()
  }

  return (
    <BottomSheet visible={visible} onClose={onClose}>
      <SheetHeader title="Filter" onClose={onClose} />
      <ScrollView className="flex-1" contentContainerClassName="gap-6 px-5 pb-6 pt-2" keyboardShouldPersistTaps="handled">
        <Section title="Search">
          <View
            className="flex-row items-center gap-2 px-4"
            style={{
              height: 48,
              borderRadius: borderRadius.sm,
              backgroundColor: colors.background,
              borderWidth: 1,
              borderColor: colors.border,
            }}
          >
            <Ionicons name="search" size={18} color={colors.textSecondary} />
            <TextInput
              value={draft.search}
              onChangeText={(search) => setDraft({ ...draft, search })}
              placeholder="Merchant, description or note"
              placeholderTextColor={colors.textMuted}
              autoCorrect={false}
              autoCapitalize="none"
              returnKeyType="search"
              clearButtonMode="while-editing"
              style={{
                flex: 1,
                fontSize: fontSize.base,
                fontFamily: fontFamily.sans,
                color: colors.textPrimary,
              }}
            />
          </View>
        </Section>

        <Section title="Type">
          <ChipRow>
            {KINDS.map(({ kind, label, icon, color }) => (
              <Chip
                key={kind}
                label={label}
                selected={draft.kinds.includes(kind)}
                onPress={() => setDraft({ ...draft, kinds: toggle(draft.kinds, kind) })}
                leading={<Ionicons name={icon} size={18} color={color} />}
              />
            ))}
          </ChipRow>
        </Section>

        <Section title="Category">
          <ChipRow>
            {categoryChoices.map((category) => (
              <Chip
                key={category.id}
                label={category.name}
                selected={draft.categoryIds.includes(category.id)}
                onPress={() => toggleCategory(category.id)}
                leading={<CategoryIcon icon={category.icon} size={18} color={category.color} />}
              />
            ))}
            <Chip
              label="Uncategorized"
              selected={draft.categoryIds.includes(null)}
              onPress={() => toggleCategory(null)}
              leading={<CategoryIcon icon={null} size={18} color={colors.textSecondary} />}
            />
          </ChipRow>
        </Section>

        {subcategoryGroups.length > 0 ? (
          <Section title="Subcategory">
            <View className="gap-3">
              {subcategoryGroups.map(({ category, subs }) => (
                <View key={category!.id} className="gap-2">
                  <Text className="font-sansMed text-sm text-textPrimary">{category!.name}</Text>
                  <ChipRow>
                    {subs.map((sub) => (
                      <Chip
                        key={sub.id}
                        label={sub.name}
                        selected={draft.subcategories.some((s) => s.id === sub.id)}
                        onPress={() => toggleSubcategory(sub)}
                      />
                    ))}
                  </ChipRow>
                </View>
              ))}
            </View>
          </Section>
        ) : null}

        <Section title="Other">
          <ChipRow>
            {FLAGS.map(({ flag, label, icon }) => (
              <Chip
                key={flag}
                label={label}
                selected={draft.flags.includes(flag)}
                onPress={() => setDraft({ ...draft, flags: toggle(draft.flags, flag) })}
                leading={<Ionicons name={icon} size={17} color={colors.primary} />}
              />
            ))}
          </ChipRow>
        </Section>

        <Section title="Amount">
          <Text className="mb-3 text-center font-display text-lg text-primary">
            {draft.amountMin == null && draft.amountMax == null
              ? 'Any amount'
              : `${wholeDollars(low)} – ${draft.amountMax == null ? `${wholeDollars(amountCeiling)}+` : wholeDollars(high)}`}
          </Text>
          <RangeSlider
            low={amountToPosition(low, amountCeiling)}
            high={amountToPosition(high, amountCeiling)}
            onChange={setAmountRange}
            accessibilityLabel="Amount range"
          />
          <View className="mt-2 flex-row justify-between">
            <Text className="font-sansMed text-xs text-textPrimary">$0</Text>
            <Text className="font-sansMed text-xs text-textPrimary">{wholeDollars(amountCeiling)}+</Text>
          </View>
        </Section>
      </ScrollView>

      <View
        className="flex-row gap-3 border-t px-5 pt-3"
        style={{
          borderColor: colors.border,
          paddingBottom: Math.max(insets.bottom, 12),
        }}
      >
        <View className="flex-1">
          <Button label="Reset" variant="secondary" onPress={() => setDraft(EMPTY_CALENDAR_FILTER)} />
        </View>
        <View style={{ flex: 2 }}>
          <Button
            label={`Show ${matchCount.toLocaleString('en-US')} ${matchCount === 1 ? 'transaction' : 'transactions'}`}
            onPress={apply}
          />
        </View>
      </View>
    </BottomSheet>
  )
}

function wholeDollars(amount: number): string {
  return `$${Math.round(amount).toLocaleString('en-US')}`
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <View className="gap-3">
      <Text className="font-sansSemi text-sm text-textPrimary">{title}</Text>
      {children}
    </View>
  )
}

function ChipRow({ children }: { children: ReactNode }) {
  return <View className="flex-row flex-wrap gap-2">{children}</View>
}

function Chip({
  label,
  selected,
  onPress,
  leading,
}: {
  label: string
  selected: boolean
  onPress: () => void
  leading?: ReactNode
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected }}
      className="flex-row items-center gap-1.5 rounded-full px-3.5 active:opacity-70"
      style={{
        height: 38,
        borderWidth: 1,
        borderColor: selected ? colors.primary : colors.border,
        backgroundColor: selected ? colors.primaryMuted : colors.background,
      }}
    >
      {leading}
      <Text className={`font-sansMed text-sm ${selected ? 'text-primary' : 'text-textPrimary'}`}>{label}</Text>
    </Pressable>
  )
}
