# Apple Card, Cash & Savings via FinanceKit

> Adds Apple Card, Apple Cash, and Apple Savings as a second account source alongside Plaid.
> Data is read on-device through Apple's FinanceKit framework and never leaves the device.

Pairs with `docs/product.md` and `docs/architecture.md`. Read those
first — this spec doesn't restate their contents, only how this codebase implements them.

## Context

Plaid cannot reach Apple Card, Apple Cash, or Apple Savings. Plaid's Link UI reports the
institution as unsupported, and the SDK's `Transaction` object carries no MCC field, so there is no
Plaid-side path at any tier. Users whose primary card is an Apple Card therefore see understated
liabilities in net worth, budgets that miss a large share of their spending, and skewed category
breakdowns. Their only workaround today is entering transactions by hand.

Apple's FinanceKit is the only route. The entitlement (`com.apple.developer.financekit`, value
`["financial-data"]`) is granted per bundle ID and requires an App Store app in the Finance
category — both satisfied. The FinanceKit entitlement request states that FinanceKit data stays on
the device and is never transmitted to our backend; this spec is bound by that commitment.

The codebase is already shaped for this. `useAccounts` is the single funnel every account consumer
passes through, `TransactionFeedProvider` is the same for transactions, categorization already runs
client-side over a narrow input, sync cursors already live on the device, and `account_orders` is
keyed by a plain `text` account id. A client-side account source fits these seams as they exist.

## Architecture

**A client-side source normalized to the existing shapes, merged at the two existing funnels.**

FinanceKit records are adapted into the `Account` and transaction shapes the app already carries and
concatenated in `useAccounts` and `TransactionFeedProvider`. Everything downstream — `mergeFeed`,
`resolveCategory`, vendor mappings, overrides, transfer auto-match, `aggregateMonth`, net worth
composition — runs unchanged.

Provenance is carried by the synthetic `itemId: 'financekit'` on the account, not by a new
transaction-level tag. `FeedItem.source` stays `'plaid' | 'manual' | 'investment'`: it drives
`TransactionRow`'s visual variant rather than reporting data origin, and an Apple Card row should
render exactly like any other card row. Where the *categorization* path matters, `categorySource`
already distinguishes it via `'mcc_pfc'`.

Rejected alternatives:

- **A first-class FinanceKit variant threaded through the feed as a discriminated union.** More
  honest typing, but it touches `resolveFeed`, `aggregateMonth`, `autoMatch`, `sweepExclusion`, and
  `pruneOrphaned` — five modules that today reason about one shape — to avoid a few null fields in
  one small, well-tested adapter.
- **Backend-registered account stubs.** Adds a table, a router, and a drift problem (the server's
  stub list versus what FinanceKit actually authorizes) to solve what `account_orders` already
  solves by accepting arbitrary text ids.

## Native bridge: `expo-finance-kit`

FinanceKit is a Swift-only framework, so a native bridge is required; JavaScript cannot reach
`FinanceStore`. The bridge is the third-party `expo-finance-kit` (0.2.23, MIT, no runtime deps)
rather than a hand-written module, per an explicit decision to prefer an available library.

Adopting it forced the app's iOS deployment target from **16.4 to 17.4** (`expo-build-properties`),
because its podspec declares `:ios => '17.4'` and CocoaPods refuses a pod whose minimum exceeds the
project's. Acceptable: FinanceKit itself requires 17.4, and iOS 17.4 shipped in March 2024.

Eight upstream defects are worked around rather than tolerated. The count, more than any single one,
is the argument for re-evaluating the dependency: a package at ~50 downloads/week that does not
compile against a current SDK is not tracking Apple's releases.

1. **The entitlement is written as a boolean.** `plugin/build/withEntitlements.js` sets
   `com.apple.developer.financekit = true`; Apple's value is `["financial-data"]`. Corrected by
   `plugins/withFinanceKitEntitlement.js`, which must be listed **before** `expo-finance-kit` in
   `app.json` — `withEntitlementsPlist` composes mods so the last-registered runs first, so the
   earliest-listed plugin gets the final write. Verified by `expo config --type introspect`.
2. **A background-delivery app extension is enabled by default.** Suppressed with
   `enableBackgroundDelivery: false`, which also drops the app group and background modes.
3. **A `BGTaskSchedulerPermittedIdentifiers` entry is added unconditionally**
   (`com.expo.financekit.sync`) for a task we never register. Stripped by the same local plugin.
4. **The documented plugin reference does not resolve.** The package ships no `app.plugin.js` and
   its `main` is the JS API, so it is referenced by path:
   `expo-finance-kit/plugin/build/index.js`.
5. **The Swift does not compile against the iOS 26 SDK.** `ExpoModulesCore` transitively imports
   SwiftUI, whose `Transaction` collides with `FinanceKit.Transaction`; nine type-position uses are
   qualified by the patch. One surfaced as "invalid component of Swift key path" rather than as an
   ambiguity, because `\Transaction.transactionDate` cannot form against an ambiguous type.
6. **`getBalances` discards the booked balance.** For `.availableAndBooked` it returned only
   `available` — a card's *remaining credit* — and emitted no `balanceType` despite its TypeScript
   declaring one. This is what displayed an Apple Card's credit limit where its balance belongs.
   Patched to emit `available`, `booked`, and `balanceType`.
7. **`creditDebitIndicator` is sent as a number.** FinanceKit's `CreditDebitIndicator` is an
   `Int16` enum and the package forwards `.rawValue` (0 = credit, 1 = debit) while typing it as
   `'credit' | 'debit'`. Comparing against the string matched nothing, so every amount was signed
   negative and every purchase rendered as income. Normalized in TypeScript rather than patched, so
   an upstream fix cannot break us.
8. **`postedDate`, `originalTransactionDescription`, and `creditLimit` are dropped.** All three
   exist on FinanceKit and are restored by the patch.

All patches live in `frontend/patches/expo-finance-kit+0.2.23.patch`, applied by `patch-package`
from a `postinstall` hook — without it the next `npm install` reverts them and the build breaks with
no obvious cause.

After patching, one FinanceKit capability remains unused: the liability account's
`nextPaymentDueDate` and `minimumNextPaymentAmount`, which the credit-card-payment feature could
consume. Not worth a further patch until that feature asks for it.

`lib/financekit/financeKitModule.ts` is the only file that imports the package. The raw types in
`types.ts` model FinanceKit itself, not this package, so replacing or supplementing the dependency
touches one file.

## Data layer: `frontend/lib/financekit/`

### `store.ts`

A dedicated MMKV instance, id `tofi-financekit`, holding adapted transactions per account and a
single `last-synced-at` watermark. Separate from `tofi-transaction-cache` so the Plaid cache's prune
and cursor logic is untouched, and so revoking Wallet access can clear FinanceKit data without
touching Plaid's.

### `adaptAccount.ts`

Purely structural. Targets Plaid's `AccountBase` plus the app's `{ itemId, institutionName,
institutionLogo }` extension.

| FinanceKit | Normalized |
| --- | --- |
| `id: UUID` | `account_id` |
| `displayName` | `name` |
| `accountDescription` | `official_name` |
| `.asset` + savings | `type: 'depository'`, `subtype: 'savings'` |
| `.asset` + Apple Cash | `type: 'depository'`, `subtype: 'prepaid'` |
| `.liability` | `type: 'credit'`, `subtype: 'credit card'` |
| `creditInformation.creditLimit` | `balances.limit` |
| `currencyCode` | `balances.iso_currency_code` |
| — | `mask: null`, `institutionLogo: null`, `itemId: 'financekit'` |

`AccountBalance.currentBalance` is an enum — `.available`, `.booked`, or `.availableAndBooked` —
mapping onto `balances.available` / `balances.current`, with the absent one left null.

The synthetic `itemId: 'financekit'` is what makes institution grouping, account ordering, and the
item-error channel work without special cases.

### `adaptTransaction.ts`

Purely structural. **It does not categorize.** `merchantCategoryCode` is carried through as
`mcc: string | null` and `pfcPrimary` / `pfcDetailed` are left null.

| FinanceKit | Normalized |
| --- | --- |
| `id: UUID` | `transaction_id` |
| `accountID` | `account_id` |
| `transactionDescription` | `name` |
| `originalTransactionDescription` | `original_description` |
| `merchantName` | `merchant_name` |
| `merchantCategoryCode` | `mcc` |
| `transactionAmount` + `creditDebitIndicator` | signed `amount`, Plaid convention (debit positive) |
| `status` | `pending` |
| `postedDate` ?? `transactionDate` | `date`, sliced to `YYYY-MM-DD` — `groupByDay` uses it verbatim as bucket key and day header, so a timestamp gives every row its own day |

Null, with no FinanceKit equivalent: `payment_channel`, `counterparties`, `location`,
`payment_meta`, `pending_transaction_id`, `logo_url`, `website`. Auditing consumers that assume
these are present is part of the implementation.

Sign conventions for liability balances and for credits are isolated in a single `signOf()` helper
with a test asserting the assumption, so correcting it against real data is a one-line change.

### `mccToPfc.ts`

An explicit `Record<MCC, PfcDetailedCode>` for common codes plus range rules for the ISO 18245
blocks (3000–3299 airlines, 3300–3499 car rental, 3500–3999 lodging, and so on). Frontend-only,
since this data never leaves the device.

**Applied at resolve time, not at ingest.** The sync only re-reads a trailing window, so any row
older than that window is never read again; a PFC code baked into the cache would be permanent for
exactly the rows most likely to be wrong, and fixing a crosswalk error would require clearing the
watermark and refetching all history. Resolving late means a crosswalk correction applies to
already-cached data on the next render.

`resolveCategory` in `lib/transactions/resolveFeed.ts` takes
`{ transactionId, merchantName, pfcPrimary?, pfcDetailed? }` — a narrow input, not a Plaid
transaction. The caller derives `{ pfcPrimary, pfcDetailed }` from the MCC immediately before
calling it, so `resolveFeed` never learns FinanceKit exists.

Output feeds the user's existing `plaid_category_mappings`, so customizations they have already
made apply to Apple Card on day one. No new backend table, no new settings screen. Unmapped or null
MCC falls through to the same uncategorized path a Plaid transaction with no PFC already takes.

`CategorySource` gains `'mcc_pfc'`, distinct from `'plaid_pfc'`, so provenance stays truthful
wherever that field is surfaced.

### `syncEngine.ts`

`expo-finance-kit` exposes no history token — its `TransactionQueryOptions` is date-range and filter
based, and the `getHistoryToken` API belongs to the background-delivery event flow we disable. So the
sync re-reads a **trailing window** instead of applying a delta:

- The store holds a watermark (`getLastSyncedAt`), not a cursor. Null means read everything.
- Each run reads from `watermark − 7 days`. The overlap matters: a charge can post days after it was
  authorized and statement credits appear later still, both changing rows already behind the
  watermark that a strict `since` read would miss forever.
- `planWindowedMerge` treats the window as authoritative — inserts, amount changes, pending→posted
  transitions, and disappearances all fall out of one rule. Rows older than the window are kept.
- The watermark advances only after every merge lands, so a failed read replays the window.
- Iteration is over *accounts*, not fetched rows: an account that returned nothing still needs the
  window applied, or a transaction deleted in Wallet would linger forever.

Accounts and balances are re-read in full every run — there are at most three, so a full read costs
less than tracking them incrementally and a balance change can never be missed.

Triggered on app launch after auth resolves, and from the existing pull-to-refresh. Written so a
background caller would work; nothing wires one up.

### `financeKitDriver.ts`

A module-level driver, not state inside a hook. `useAccounts` is called from eight components, so
anything living inside it runs eight times — and per-component refs cannot guard against that, which
is the same lesson `TransactionFeedProvider`'s docstring records about the Plaid feed. The driver
collapses concurrent runs, applies a 30s cooldown so remounts are free, exposes a
`useSyncExternalStore`-stable snapshot, and resolves `syncNow` to the resulting snapshot so a caller
can branch on a denial without racing React state. Failures land on the snapshot rather than
throwing, because a FinanceKit error must not blank the accounts screen.

Cheaper than `syncDriver`: the read is local, so there are no cursors, rate limits, or per-item
isolation to coordinate.

`driver.ts` holds the single instance, separate so the driver's tests never import
expo-finance-kit.

## Permissions and UI

Entry point: a row in `components/accounts/AddAccountSheet.tsx` under `SOMEWHERE ELSE` — "Apple
Card, Cash & Savings", subtitle "Reads from Wallet on this iPhone" — rendered only when
`isDataAvailable()`. It is the one add-account path that costs no Plaid connection, a deliberate
contrast with the adjacent row's "Uses one of your Plaid connections".

| Status | Behavior |
| --- | --- |
| `notDetermined` | Row visible; tapping calls `requestAuthorization()` |
| `authorized`, accounts returned | Backfill, then normal operation |
| `authorized`, zero accounts | Not success — the user enabled no accounts in iOS Settings. Show "Turn on accounts in Settings" with a `Linking.openSettings()` action |
| `denied` / `restricted` | Row presented as needing Settings, not as a failure |
| Revoked after working | Synthesized item error, below |

**Revocation reuses the existing item-error channel.** `useAccounts` synthesizes
`{ itemId: 'financekit', institutionName: 'Apple', message }` into the same `itemErrors` array the
backend populates for broken Plaid items. Two behaviors then come for free: `app/(tabs)/accounts.tsx`
renders it like any unreachable institution, and `TransactionFeedProvider` already builds a `Set` of
errored `itemId`s and skips those accounts, so a revoked Apple connection drops out of transactions,
budgets, and net worth with no new code. The only addition is an "Open Settings" affordance.

**Disconnecting.** FinanceKit access cannot be revoked programmatically. "Remove Apple accounts"
clears the `tofi-financekit` store and its tokens, then points the user to iOS Settings to turn
access off. Orphaned server-side metadata (overrides, `account_orders` rows, transfers) follows the
patterns already in `planCachePrune` and `findOrphanedTransfers` rather than a second cleanup path.

## Build gating

The entitlement is applied unconditionally — it has been granted, assigned to the App ID, and the
provisioning profile regenerated, so there is no longer a window in which an entitlement-bearing
build would fail to sign. `NSFinancialDataUsageDescription` is set to app-specific copy rather than
the package's generic default, since App Review reads it.

Verify the whole chain without touching `ios/`:

```bash
npx expo config --type introspect | grep -A2 developer.financekit   # must be an array
```

eas-cli does not manage this capability — FinanceKit is absent from its `CapabilityMapping`, and its
capability-disable path only touches capabilities it knows, so a manually enabled FinanceKit
capability is left alone. Re-verify this after an eas-cli upgrade.

## Testing

Everything except the Swift shim is testable before real data exists, under the existing
`frontend/vitest.config.ts`:

- **`mccToPfc`** — lookups and range rules, plus an exhaustiveness test asserting every code it
  emits exists in `DEFAULT_PFC_MAPPING.detailedCodes`. That is a value import from `backend/` in a
  frontend test, which is fine: `.github/workflows/frontend-eas.yml` already runs
  `npm ci --prefix ../backend`.
- **Adapters** — structural assertions over raw-JSON fixtures.
- **`syncEngine`** — token persistence, delta application, UUID dedupe, backfill-after-regrant,
  against a fake module interface.
- **Permission states** — a pure reducer over status transitions, including revoke-while-running.
- **Resolve integration** — extends the existing `resolveFeed` tests with MCC-derived PFC and
  `'mcc_pfc'`.

A **fixture-backed fake module**, behind a dev flag, drives the whole UI on a simulator with
synthetic Apple accounts. FinanceKit has no sandbox, so this is the only way to exercise the real
screens; it doubles as the test double.

Implementation order: `mccToPfc` → adapters → `syncEngine` → resolve integration → UI states →
Swift module last, since it is the only piece with nothing worth testing.

## Deferred to grant-day verification

Confirmed only against real data, as an explicit checklist:

Answered on the first device run: Apple returns `availableAndBooked` for Apple Card, the indicator
arrives as an Int16 raw value, and dates needed slicing. Still open:

1. Liability balance sign convention. `adaptAccount` takes the magnitude of the booked balance,
   since Plaid reports a card's current balance positive when owed. An overpaid card would read as
   a positive balance under that rule.
2. MCC coverage against a real transaction sample — the two `账单付款` rows in the first device run
   came through uncategorized, which is expected for a bill payment with no MCC.
3. How far back `getTransactions` will actually return data with no `startDate`.

## Open questions

1. **Override durability.** `transaction_overrides` is server-stored and keyed by transaction id.
   Whether FinanceKit's transaction UUIDs are stable across a reinstall or a second device is not
   documented. If they are not, a user's Apple Card corrections silently orphan. Options: accept it,
   or key FinanceKit overrides by a content hash. Deliberately parked, not resolved.
2. **`accounts.list` precondition.** It throws when no Plaid credentials are saved, so an
   Apple-Card-only user would hard-fail. Theoretical while BYO-Plaid onboarding gates the app, and
   real the moment that onboarding is reconsidered.

## Out of scope

- **Background delivery.** `enableBackgroundDelivery` and a background-task-driven sync. Budget
  alerts for Apple Card spending will fire when the app is opened, which is already true of every
  Plaid account.
- **Apple's transaction-picker UI.** `com.apple.developer.financekit.transaction-picker` is a
  separate entitlement requiring its own approval.
- **A user-editable MCC mapping screen.** Corrections go through the existing per-transaction
  override and vendor-mapping flows, which already work on any feed item.
- **Android.** Not supported by the app.
