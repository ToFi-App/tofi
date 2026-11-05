import { MMKV } from 'react-native-mmkv'

// Device-local display preferences only — never financial data, which is fetched live and
// never persisted server-side (architecture.md). Separate from the transaction-cache
// instance because these outlive any one signed-in user: a preference is about this
// device, not about whose data is loaded.
export const preferences = new MMKV({ id: 'ledge-preferences' })

export const AMOUNTS_MASKED_KEY = 'amountsMasked'
/** How Home draws spending against last month: 'gap' (ahead/behind) or 'total' (running totals). */
export const SPENDING_CHART_VIEW_KEY = 'spendingChartView'
