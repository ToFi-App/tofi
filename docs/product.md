# ToFi — Product Spec
> Agent context document. Read this before writing any code. Pairs with `architecture.md` (backend/data layer) and `design.md` (UI/visual system).

---

## Overview

ToFi is a personal budgeting app for iOS (React Native / Expo) that connects to bank, credit card, and investment accounts via Plaid. Users categorize transactions, set budgets, and track reimbursements. Initial target: small closed group of friends.

Each user connects Plaid using their **own** Plaid developer credentials (client ID + secret), obtained free from their own Plaid dashboard account. This keeps every user's linked-Item usage isolated under their own account rather than sharing one app-wide Plaid key — see `architecture.md` for why, and the BYOK Plaid Setup section below for the user-facing flow.

---

## Core Principle: Data Privacy

Raw financial data (transactions, balances, account numbers) **never persists in the backend database**. Only user-defined metadata (categories, budgets, vendor mappings, reimbursement links) is stored server-side. Plaid transaction/balance data is fetched live through the backend on each request and cached only on-device — the backend relays it but never writes it to a table. Full mechanics in `architecture.md`.

---

## Features

### 0. Plaid Developer Account Setup (BYOK)

Required, one-time, before a user can link any bank account.

- New Settings screen: **"Connect your Plaid developer account"**
  - Fields: Client ID (plain text input), Secret (masked/password-style input), Environment (segmented control: Sandbox / Production)
  - Expandable "How to get these" section with a link to `dashboard.plaid.com/signup` and plain-language steps: create a free Plaid account → find Client ID + Secret under Developers → Keys → (for real bank data) request the free Trial plan or Production access
  - "Test Connection" action: validates the entered credentials against Plaid before saving, so typos or wrong-environment mismatches surface immediately with a clear error rather than failing later during Link
  - Once saved, the Secret is never shown again in plaintext — the field displays a masked placeholder with a "Replace" action
- Plaid Link is gated behind this: if a user has no saved credentials, the "Link your bank" entry point routes to this screen instead of opening Plaid Link
- Users can revisit this screen any time to update or replace their credentials (e.g. after rotating their Plaid secret)

### 1. Account Linking (Plaid Link)

- Embed Plaid Link SDK (`react-native-plaid-link-sdk`) on-device for the bank-authentication handshake only
- On success, the resulting `public_token` is sent to the backend, which exchanges it for an `access_token` using the user's own stored Plaid credentials
- Support: checking, savings, credit cards, investment accounts
- Show linked institutions on an "Accounts" screen with live balances (fetched through the backend from Plaid on each view, never stored)

### 2. Transaction Feed

- Fetch via the backend's transactions-sync endpoint on app open + pull-to-refresh, using PFCv2 (`personal_finance_category_version: 'v2'`)
- Cache in local SQLite/MMKV with last-cursor stored per item
- Display: merchant name, amount, date, account, category badge
- Category resolution order at render time (client-side):
  1. `transaction_overrides` for this specific Plaid transaction ID (highest priority)
  2. `vendor_mappings` with `source='user_defined'` for this merchant_name
  3. `vendor_mappings` with `source='plaid_auto'` for this merchant_name
  4. The transaction's own `personal_finance_category` through `plaid_category_mappings` — `detailed` first, then `primary` (preferring a primary-only row, else any row sharing the primary)
  5. "Uncategorized" fallback
- Step 4 is what keeps the long tail out of "Uncategorized", and steps 1–3 alone are not sufficient: they all key on `merchant_name`, which Plaid leaves null for anything it can't merchant-enrich (ACH, checks, Zelle, direct deposits), and `plaid_auto` vendor_mappings are only generated once during onboarding, so any merchant first seen afterwards has no row. Both cases still arrive carrying a valid PFC.
- Steps 1–3 rank above step 4 so a user's own categorization always beats Plaid's guess. Step 4 resolves a category only — never a subcategory, since `plaid_category_mappings` binds PFC codes to categories and subcategories have no Plaid equivalent.
- Manual transactions are fetched from the backend and merged into the local cache; their category is stored directly on the `manual_transactions` row (no override or vendor mapping needed)
- Feed is sorted by date descending across both Plaid and manual transactions
- Show "?" badge on rows where the underlying vendor_mapping has `MEDIUM` Plaid confidence
- Filter/search by: date range, category, account, amount range
- Sort: date (default), amount

### 3. Onboarding — Category Setup & Initial Auto-Categorization

This happens once, immediately after the user links their first Plaid account (which itself happens after Feature 0, BYOK setup).

**Step 1 — Seed categories from Plaid's taxonomy**

On first launch, seed the user's `categories`, `subcategories`, and `plaid_category_mappings` from a hardcoded default mapping in `lib/plaid/pfc.ts` (backend). The default mapping assigns Plaid's detailed PFC codes (not just primaries) to ToFi categories, so categorization is as precise as possible out of the box.

Default mapping (abbreviated — full list in `lib/plaid/pfc.ts`):

| ToFi Default Category | Plaid PFC Detailed Codes Assigned | Default Subcategories |
|---|---|---|
| Food & Drink | `FOOD_AND_DRINK_RESTAURANTS`, `FOOD_AND_DRINK_FAST_FOOD`, `FOOD_AND_DRINK_GROCERIES`, `FOOD_AND_DRINK_COFFEE`, `FOOD_AND_DRINK_ALCOHOL_AND_BARS`, `FOOD_AND_DRINK_FOOD_DELIVERY_SERVICES` | Restaurants, Groceries, Coffee, Bars |
| Transport | `TRANSPORTATION_TAXIS_AND_RIDE_SHARING`, `TRANSPORTATION_GAS_AND_CONVENIENCE_STORES`, `TRANSPORTATION_PUBLIC_TRANSIT`, `TRANSPORTATION_PARKING`, `TRANSPORTATION_AUTOMOTIVE` | Rideshare, Gas, Transit, Parking |
| Travel | `TRAVEL_FLIGHTS`, `TRAVEL_HOTELS_AND_MOTELS`, `TRAVEL_RENTAL_CARS`, `TRAVEL_VACATION_RENTALS` | Flights, Hotels, Vacation |
| Entertainment | `ENTERTAINMENT_MUSIC_AND_AUDIO`, `ENTERTAINMENT_TV_AND_MOVIES`, `ENTERTAINMENT_VIDEO_GAMES`, `ENTERTAINMENT_SPORTING_EVENTS_AMUSEMENT_PARKS_AND_MUSEUMS` | Streaming, Events, Games |
| Shopping | `GENERAL_MERCHANDISE_ONLINE_MARKETPLACES`, `GENERAL_MERCHANDISE_CLOTHING_AND_ACCESSORIES`, `GENERAL_MERCHANDISE_ELECTRONICS` | Clothing, Electronics, Amazon |
| Bills & Utilities | `RENT_AND_UTILITIES_RENT`, `RENT_AND_UTILITIES_ELECTRICITY`, `RENT_AND_UTILITIES_INTERNET_AND_CABLE`, `RENT_AND_UTILITIES_TELEPHONE` | Rent, Electric, Internet, Phone |
| Health | `MEDICAL_DOCTOR_VISITS`, `MEDICAL_PHARMACIES_AND_SUPPLEMENTS`, `MEDICAL_DENTAL`, `MEDICAL_VISION` | Doctor, Pharmacy, Dental |
| Personal Care | `PERSONAL_CARE_HAIR_AND_BEAUTY`, `PERSONAL_CARE_GYM_AND_FITNESS` | Hair, Gym |
| Home | `HOME_IMPROVEMENT_FURNITURE`, `HOME_IMPROVEMENT_HARDWARE`, `HOME_IMPROVEMENT_REPAIR_AND_MAINTENANCE` | Furniture, Repairs |
| Services | `GENERAL_SERVICES_SUBSCRIPTION`, `GENERAL_SERVICES_INSURANCE`, `GENERAL_SERVICES_FINANCIAL_PLANNING_AND_MANAGEMENT` | Subscriptions, Insurance |
| Income | `INCOME_WAGES`, `INCOME_OTHER_INCOME`, `INCOME_INTEREST_EARNED`, `INCOME_DIVIDENDS` | Paycheck, Interest |
| Transfers In | `TRANSFER_IN_ACCOUNT_TRANSFER`, `TRANSFER_IN_DEPOSIT`, `TRANSFER_IN_WIRE` | Zelle, Venmo |
| Transfers Out | `TRANSFER_OUT_ACCOUNT_TRANSFER`, `TRANSFER_OUT_SAVINGS`, `TRANSFER_OUT_WIRE` | Zelle, Venmo |
| Loans Received | `LOAN_DISBURSEMENTS_STUDENT`, `LOAN_DISBURSEMENTS_AUTO`, `LOAN_DISBURSEMENTS_PERSONAL` | Student, Auto, Personal |
| Payments | `LOAN_PAYMENTS_STUDENT_LOAN_PAYMENT`, `LOAN_PAYMENTS_CREDIT_CARD_PAYMENT`, `LOAN_PAYMENTS_MORTGAGE_PAYMENT` | Student Loans, Credit Card |
| Fees | `BANK_FEES_ATM_FEES`, `BANK_FEES_OVERDRAFT_FEES`, `BANK_FEES_FOREIGN_TRANSACTION_FEES` | — |
| Other | `GOVERNMENT_AND_NON_PROFIT_GOVERNMENT_DEPARTMENTS_AND_AGENCIES`, `GOVERNMENT_AND_NON_PROFIT_NON_PROFIT` | — |

Every PFC detailed code in Plaid's taxonomy must be assigned to exactly one default ToFi category in `lib/plaid/pfc.ts`. No PFC code should be left unassigned in the defaults.

The taxonomy version is pinned to **v2** in `transactionRepository.sync` via `options.personal_finance_category_version`. This is required, not cosmetic: unpinned, Plaid serves v1 to accounts granted Transactions access before 2025-12-03 and v2 after, so under BYOK two users on the same build would receive different taxonomies while `DEFAULT_PFC_MAPPING` stays a single hardcoded table. v2 is a superset of v1, so pinning up is the version that can be mapped exhaustively. Note that `pfc.test.ts`'s coverage check is self-referential and cannot detect drift from Plaid's real taxonomy — diff `pfc.ts` against https://plaid.com/documents/pfc-taxonomy-all.csv by hand when revising.

These are written to the backend database as the user's starting categories. The user can rename, recolor, merge, or delete any of them, and reassign PFC codes between categories, from Settings → Categories at any time.

**Step 2 — Auto-generate vendor_mappings from first transaction sync**

After seeding categories and fetching the initial transaction history:
- For every transaction, resolve its ToFi category using this lookup order:
  1. Match `personal_finance_category.detailed` → `plaid_category_mappings` (preferred, more precise)
  2. Fall back to `personal_finance_category.primary` → `plaid_category_mappings` (primary-only row where `plaid_pfc_detailed` IS NULL)
- Write a `vendor_mapping` record: `merchant_name` → resolved `category_id`, with `source='plaid_auto'`
- Deduplicate: one mapping per unique `merchant_name` (first match wins)
- This means nearly all historical transactions are categorized immediately, before the user touches anything

**Step 3 — Confidence handling**

Plaid returns a `confidence_level` (`VERY_HIGH`, `HIGH`, `MEDIUM`) on each transaction's category:
- `VERY_HIGH` / `HIGH` → apply silently, no badge
- `MEDIUM` → apply the category but show a small "?" badge on the transaction row as a nudge to review

### 4. Categories & Subcategories (Settings)

**Creating a category**
1. User enters: name, color (hex), icon
2. User must select which Plaid PFC codes belong to this category — required, cannot save without at least one
3. UI shows the full Plaid PFC list grouped by primary (expandable), with checkboxes on each detailed subcategory
4. Already-claimed PFC codes (assigned to another category) are shown as disabled with a label showing which category owns them
5. On save: write `categories` row + `plaid_category_mappings` rows for each selected PFC code

**Editing a category**
- Same form as create, PFC selections pre-checked
- Removing a PFC code from the category: any existing `vendor_mappings` with `source='plaid_auto'` that were derived from that PFC are invalidated (deleted or flagged); `user_defined` mappings are unaffected
- User can reassign removed PFC codes to a different category

**Deleting a category**
- Prompt: "Reassign transactions to [picker] or leave uncategorized?"
- PFC codes owned by deleted category become unassigned and are surfaced in a "Unmapped PFC codes" warning in Settings

**Subcategories**
- Each subcategory belongs to one parent category
- Free-form name, no PFC binding required (subcategories are user-defined refinements, not Plaid concepts)

**CRUD UI lives at Settings → Categories**

### 5. Transaction Categorization

- Every transaction is auto-categorized on load: via vendor_mappings where one exists (see Onboarding above), otherwise via its own PFC through `plaid_category_mappings` (step 4 of the resolution order above). Onboarding's vendor_mappings are therefore a warm start, not the only source of categories — a transaction is only "Uncategorized" if its PFC primary maps to nothing or Plaid supplied no PFC at all.
- Tap any transaction → bottom sheet with current category pre-selected
- User can change category + optional subcategory
- On save:
  - Write `transaction_override` for this specific transaction
  - Upsert `vendor_mapping` for this merchant with `source='user_defined'`
  - Prompt: "Apply to all past [Vendor] transactions too?" — if yes, bulk-write overrides for matching merchant_name in local cache
- `user_defined` vendor_mappings always take precedence over `plaid_auto` ones
- Visual indicator on transaction row distinguishing auto-categorized vs user-confirmed (e.g. subtle checkmark icon)

### 6. Manual Transactions

**Adding a manual transaction:**
- Floating `+` button on the Transactions screen → "Add Transaction" bottom sheet
- Fields:
  - **Type**: Expense / Income toggle (default: Expense)
  - **Amount**: numeric input, always positive
  - **Category**: category picker (same CategoryPicker component as recategorization)
  - **Subcategory**: optional, shown after category selected
  - **Date**: date picker, defaults to today
  - **Note**: optional free-text field
- On save: write to `manual_transactions` via the backend; insert into local transaction cache alongside Plaid transactions
- Manual transactions are displayed in the feed with a small pencil icon indicator to distinguish them from Plaid-sourced transactions

**Editing a manual transaction:**
- Tap the transaction row → same bottom sheet, pre-filled
- All fields editable

**Deleting a manual transaction:**
- Swipe-left on the transaction row → delete action
- If the transaction is linked in a reimbursement, prompt: "This transaction is part of a reimbursement. Delete anyway?" — deleting removes the reimbursement link too

**Reimbursement linking with manual transactions:**
- A manual expense can be the expense side of a reimbursement (e.g. $100 cash dinner)
- A manual income can be the reimbursement side (e.g. $30 cash from Alice)
- The reimbursement sheet shows both Plaid and manual transactions as linkable candidates on both sides
- Manual income transactions appear in the "Link incoming payment" list alongside Plaid transfers

### 7. Budgets

- Set a monthly (or weekly/yearly) budget per category
- Budget overview screen: progress bars per category, total spent vs budget
- Color coding: teal (<70%), amber (70–90%), rose (>90%)
- Push notification (optional) when a category hits 80% and 100%

### 8. Reimbursements

- On any expense transaction: "Mark as partially/fully reimbursed"
- Link one or more incoming transactions (Zelle, Venmo, etc.) as reimbursement sources
- Store in `reimbursements` table with amount
- Net expense shown on transaction and in budget calculations
- Visual indicator on reimbursed transactions (badge or strikethrough on reimbursed portion)
- Example: $100 dinner → link $30 Zelle from Alice + $30 Zelle from Bob → net expense = $40

### 9. Dashboard / Home

- Monthly spending summary
- Top spending categories (donut chart)
- Recent transactions (last 5)
- Budget health cards (categories near/over limit)
- Net spend this month (income − expenses − reimbursements)

---

## Navigation Structure

```
Tab Bar
├── Home — where the month's money went
│   ├── Grid / Chart / Calendar views (floating toggle)
│   ├── Budget summary → Budgets (pushed)
│   └── Cash flow card → Cash flow review (pushed)
├── Net Worth — what there is, per account
│   └── Investment account → Investments, filtered to it
├── Investments — performance, movers, holdings
└── Settings
    ├── Plaid Developer Account (BYOK credentials)
    ├── Accounts (linked Plaid items)
    ├── Categories
    └── Profile / Sign out
```

---

## Auth

- Supabase Auth: Google sign-in only (no email/password); Apple sign-in could follow later
- Session persisted via Expo SecureStore
- On first launch: onboarding flow → sign up → connect Plaid developer credentials (Feature 0) → link account via Plaid Link → category seeding (Feature 3)

---

## Out of Scope (v1)

- Android support (iOS first)
- Shared/joint budgets
- CSV export
- Receipt scanning
- Bill splitting calculations (ToFi tracks reimbursements but doesn't split bills)
- Investment performance tracking (accounts linkable for net worth view only)
- Managing Plaid credentials on behalf of the user (no fallback shared key — every user must bring their own)
