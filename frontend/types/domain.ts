// Types inferred directly from the backend router's output shapes — no hand-maintained
// duplicate type definitions to drift out of sync. Type-only, erased at compile time
// (see types/backend.ts's note on why this is safe to import from the mobile bundle).
import type { inferRouterInputs, inferRouterOutputs } from '@trpc/server'
import type { AppRouter } from './backend'

type RouterOutputs = inferRouterOutputs<AppRouter>
type RouterInputs = inferRouterInputs<AppRouter>

export type Category = RouterOutputs['categories']['list'][number]
export type Subcategory = RouterOutputs['subcategories']['list'][number]
export type VendorMapping = RouterOutputs['vendorMappings']['list'][number]
export type TransactionOverride = RouterOutputs['transactionOverrides']['list'][number]
export type ManualTransaction = RouterOutputs['manualTransactions']['list'][number]
export type Budget = RouterOutputs['budgets']['list'][number]
export type Transfer = RouterOutputs['transfers']['list'][number]
export type TransferDismissal = RouterOutputs['transferDismissals']['list'][number]
// Inferred from the router input rather than redeclared, so the backend's TRANSFER_KINDS stays
// the single source of truth for which kinds exist. TRANSFER_TYPES in lib/transfers/registry.ts
// is a Record keyed by this union, so a new kind fails to compile until it's fully defined.
export type TransferKind = RouterInputs['transfers']['create']['kind']
export type Account = RouterOutputs['accounts']['list']['accounts'][number]
export type AccountItemError = RouterOutputs['accounts']['list']['itemErrors'][number]
export type Institution = RouterOutputs['accounts']['listInstitutions'][number]
export type TransactionSyncResult = RouterOutputs['transactions']['sync']
export type PlaidTransaction = TransactionSyncResult['added'][number]
export type PlaidCategoryMapping = RouterOutputs['plaidCategoryMappings']['list'][number]
export type Holding = RouterOutputs['investments']['holdings'][number]
export type InvestmentTransaction = RouterOutputs['investments']['transactions']['byItem'][string][number]
export type InvestmentTransactionItemError = RouterOutputs['investments']['transactions']['itemErrors'][number]
export type InvestmentActivity = RouterOutputs['investments']['activity']['transactions'][number]
export type ActivitySecurity = RouterOutputs['investments']['activity']['securities'][number]
export type LatestPrice = RouterOutputs['investments']['latestPrices'][string]
export type DailyClose = RouterOutputs['investments']['priceHistory']['closes'][string][number]
export type Split = RouterOutputs['investments']['priceHistory']['splits'][number]
