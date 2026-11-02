import { View } from 'react-native'
import { Pill } from '@/components/ui/RangePills'
import { useNetWorthScope } from '@/hooks/useNetWorthScope'
import { setInvestmentAccountFilter } from '@/hooks/useInvestmentAccountFilter'

/** The Net Worth tab's switch: the overview of everything you have, or just the invested part of it. */
export function NetWorthScopePills() {
  const [scope, setScope] = useNetWorthScope()

  // Coming to Investments by the pill shows all of them. An account row on the Overview opens it
  // filtered to that account, and that filter shouldn't still be standing the next time you come
  // back this way.
  function showInvestments() {
    if (scope === 'investments') return
    setInvestmentAccountFilter(null)
    setScope('investments')
  }

  return (
    <View className="flex-row gap-1">
      <Pill label="Overview" isSelected={scope === 'overview'} onPress={() => setScope('overview')} />
      <Pill label="Investments" isSelected={scope === 'investments'} onPress={showInvestments} />
    </View>
  )
}
