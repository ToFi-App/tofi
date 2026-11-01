import { Pressable, Text, View } from 'react-native'
import { colors, shadow } from '@/constants/theme'
import { budgetDollars } from './BudgetRows'

export type AlertLevel = 'off' | number | 'custom'

const MARKER_LABEL_WIDTH = 72

interface AlertLevelPickerProps {
  presets: number[]
  value: AlertLevel
  onChange: (level: AlertLevel) => void
  /** Presets are shares of the budget, so they wait for one to exist. */
  disabled: boolean
}

/** When to be alerted, as one segmented track: off, a share of the budget, or a custom amount. */
export function AlertLevelPicker({ presets, value, onChange, disabled }: AlertLevelPickerProps) {
  const options: Array<{ level: AlertLevel; label: string; accessibilityLabel: string }> = [
    { level: 'off', label: 'Off', accessibilityLabel: 'No alert' },
    ...presets.map((pct) => ({ level: pct as AlertLevel, label: `${pct}%`, accessibilityLabel: `Alert at ${pct}% of the budget` })),
    { level: 'custom', label: 'Custom', accessibilityLabel: 'Alert at a custom amount' },
  ]
  return (
    <View className="flex-row rounded-full p-1" style={{ backgroundColor: colors.surfaceRaised }}>
      {options.map((option) => {
        const isSelected = option.level === value
        const isDisabled = disabled && option.level !== 'off'
        return (
          <Pressable
            key={String(option.level)}
            onPress={() => onChange(option.level)}
            disabled={isDisabled}
            accessibilityRole="button"
            accessibilityLabel={option.accessibilityLabel}
            accessibilityState={{ selected: isSelected, disabled: isDisabled }}
            className="flex-1 items-center rounded-full py-2"
            style={[isSelected ? [shadow.sm, { backgroundColor: colors.surface }] : null, { opacity: isDisabled ? 0.4 : 1 }]}
          >
            <Text className={isSelected ? 'font-sansSemi text-sm text-textPrimary' : 'font-sansMed text-sm text-textSecondary'}>
              {option.label}
            </Text>
          </Pressable>
        )
      })}
    </View>
  )
}

/**
 * Where the alert sits on the budget, drawn rather than said: a track for the month's budget, the
 * share up to the alert filled in the category's colour, and the alert's dollar figure over its tick.
 */
export function AlertLine({ alertDollars, budget, color }: { alertDollars: number; budget: number; color: string }) {
  const fraction = Math.min(1, Math.max(0, alertDollars / budget))
  return (
    <View className="gap-1.5">
      <View style={{ height: 18 }}>
        <Text
          className="text-center font-mono text-sm text-textPrimary"
          style={{
            position: 'absolute',
            width: MARKER_LABEL_WIDTH,
            // Centred over the tick, but kept inside the track at either end.
            left: `${fraction * 100}%`,
            marginLeft: fraction < 0.12 ? 0 : fraction > 0.88 ? -MARKER_LABEL_WIDTH : -MARKER_LABEL_WIDTH / 2,
            textAlign: fraction < 0.12 ? 'left' : fraction > 0.88 ? 'right' : 'center',
          }}
        >
          {budgetDollars(alertDollars)}
        </Text>
      </View>
      <View>
        <View className="flex-row overflow-hidden rounded-full" style={{ height: 6, backgroundColor: colors.surfaceRaised }}>
          <View style={{ width: `${fraction * 100}%`, backgroundColor: color, opacity: 0.45 }} />
        </View>
        <View
          style={{
            position: 'absolute',
            left: `${fraction * 100}%`,
            top: -4,
            width: 2,
            height: 14,
            marginLeft: -1,
            borderRadius: 1,
            backgroundColor: colors.textPrimary,
          }}
        />
      </View>
      <View className="flex-row justify-between">
        <Text className="font-mono text-sm text-textSecondary">$0</Text>
        <Text className="font-mono text-sm text-textSecondary">{budgetDollars(budget)}</Text>
      </View>
    </View>
  )
}
