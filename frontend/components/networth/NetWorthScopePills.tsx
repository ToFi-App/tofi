import { View } from 'react-native'
import { Pill } from '@/components/ui/RangePills'
import { setNetWorthScope, useNetWorthScope } from '@/hooks/useNetWorthScope'
import { setInvestmentAccountFilter } from '@/hooks/useInvestmentAccountFilter'

/**
 * Investments as the pill (or a swipe) opens it: all of them. An account row on the Overview opens it
 * filtered to that account, and that filter shouldn't still be standing the next time you come back
 * this way.
 */
export function showAllInvestments() {
  setInvestmentAccountFilter(null)
  setNetWorthScope('investments')
}

/** The Net Worth tab's switch: the overview of everything you have, or just the invested part of it. */
export function NetWorthScopePills() {
  const [scope, setScope] = useNetWorthScope()

  return (
    <View className="flex-row gap-1">
      <Pill size="md" label="Overview" isSelected={scope === 'overview'} onPress={() => setScope('overview')} />
      <Pill
        size="md"
        label="Investments"
        isSelected={scope === 'investments'}
        onPress={() => scope !== 'investments' && showAllInvestments()}
      />
    </View>
  )
}
