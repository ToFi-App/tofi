import { useNetWorthScope } from '@/hooks/useNetWorthScope'
import { NetWorthScreen } from '@/components/networth/NetWorthScreen'
import { InvestmentsScreen } from '@/components/networth/InvestmentsScreen'

/**
 * The Net Worth tab: an Overview and Investments, one tab with a switch at the top rather than two tabs
 * showing overlapping money. Investments are part of net worth, so they're a view of it, not a
 * place of their own. Each view is the full screen it was as a tab; only one is mounted at a time.
 */
export default function NetWorthTab() {
  const [scope] = useNetWorthScope()
  return scope === 'investments' ? <InvestmentsScreen /> : <NetWorthScreen />
}
