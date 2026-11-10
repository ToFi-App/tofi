import { useNetWorthScope } from '@/hooks/useNetWorthScope'
import { NetWorthScreen } from '@/components/networth/NetWorthScreen'
import { InvestmentsScreen } from '@/components/networth/InvestmentsScreen'
import { showAllInvestments } from '@/components/networth/NetWorthScopePills'
import { SwipeViews } from '@/components/ui/SwipeViews'

/**
 * The Net Worth tab: an Overview and Investments, one tab with a switch at the top rather than two tabs
 * showing overlapping money. Investments are part of net worth, so they're a view of it, not a
 * place of their own. Each view is the full screen it was as a tab, side by side in the switch's
 * order, swiped between as well as picked from the switch.
 */
export default function NetWorthTab() {
  const [scope, setScope] = useNetWorthScope()
  return (
    <SwipeViews
      index={scope === 'investments' ? 1 : 0}
      onIndexChange={(next) => (next === 1 ? showAllInvestments() : setScope('overview'))}
    >
      <NetWorthScreen />
      <InvestmentsScreen />
    </SwipeViews>
  )
}
