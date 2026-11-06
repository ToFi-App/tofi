import { sql } from 'drizzle-orm'
import {
  boolean,
  check,
  date,
  integer,
  numeric,
  pgSchema,
  pgTable,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core'

// Supabase's auth.users, referenced for FKs only — never written to by this app.
// Declared locally (rather than imported from drizzle-orm/supabase) so every table
// in this file resolves PgColumn/PgTable types from the exact same 'drizzle-orm/pg-core'
// module graph; mixing that import with a second subpath ('drizzle-orm/supabase') triggers
// a TypeScript nodenext dual-resolution identity split in some build environments (seen on
// Vercel, not reproducible locally even with matching Node version + a forced clean install).
// Running `npm run db:generate` after schema changes may re-emit a CREATE TABLE for this
// table — strip that statement by hand before applying, since Supabase owns that schema.
const authSchema = pgSchema('auth')
const authUsers = authSchema.table('users', {
  id: uuid('id').primaryKey(),
})

// Developer allowlist. Only these accounts may choose the sandbox Plaid environment; everyone
// else is pinned to production. Seeded by hand via SQL — deliberately not writable from the app.
// The lowercase check is a guardrail: lookups normalise the incoming email, so a mixed-case row
// would silently never match. Better to reject the bad INSERT than to debug a dev who can't
// see the toggle.
export const devEmails = pgTable('dev_emails', {
  email: text('email').primaryKey(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  lowercase: check('dev_emails_lowercase', sql`${table.email} = lower(${table.email})`),
}))

export const plaidCredentials = pgTable('plaid_credentials', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull().references(() => authUsers.id).unique(),
  clientId: text('client_id').notNull(),
  encryptedSecret: text('encrypted_secret').notNull(),
  environment: text('environment').notNull(), // 'sandbox' | 'production' — fixed at first save, never updated
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})

export const plaidItems = pgTable('plaid_items', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull().references(() => authUsers.id),
  institutionId: text('institution_id').notNull(),
  institutionName: text('institution_name').notNull(),
  // Base64 PNG from Plaid's institutionsGetById (include_optional_metadata). Nullable with a
  // sentinel: NULL = never fetched (lazy-backfilled on the next accounts.list), '' = fetched
  // and Plaid has no logo for this institution (never re-fetched).
  institutionLogo: text('institution_logo'),
  encryptedAccessToken: text('encrypted_access_token').notNull(),
  itemId: text('item_id').notNull(),
  // Soft disconnect. NULL = live. Set = the user disconnected this institution but the Item
  // still exists at Plaid, so re-enabling costs nothing. Plaid trial plans cap how many Items
  // an account may ever create and /item/remove does not refund one, which makes revoking a
  // one-way door — hence a reversible default with permanent deletion as a separate action.
  disabledAt: timestamp('disabled_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})


export const categories = pgTable('categories', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull().references(() => authUsers.id),
  name: text('name').notNull(),
  color: text('color').notNull(),
  icon: text('icon').notNull(),
  // Seeded from DEFAULT_PFC_MAPPING rather than created by the user. Defaults are renameable-proof
  // (categories.update rejects a name patch on them) so that name stays a reliable way to identify
  // which seeded category a row is — the icon backfill in drizzle/0008 needed exactly that and had
  // no way to get it. Colour and icon stay editable; only the name is pinned.
  isDefault: boolean('is_default').notNull().default(false),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})

export const subcategories = pgTable('subcategories', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull().references(() => authUsers.id),
  categoryId: uuid('category_id').notNull().references(() => categories.id),
  name: text('name').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})

export const plaidCategoryMappings = pgTable('plaid_category_mappings', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull().references(() => authUsers.id),
  plaidPfcPrimary: text('plaid_pfc_primary').notNull(),
  plaidPfcDetailed: text('plaid_pfc_detailed'),
  categoryId: uuid('category_id').notNull().references(() => categories.id),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  uniquePfc: unique().on(table.userId, table.plaidPfcPrimary, table.plaidPfcDetailed),
}))

export const vendorMappings = pgTable('vendor_mappings', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull().references(() => authUsers.id),
  vendorName: text('vendor_name').notNull(),
  categoryId: uuid('category_id').notNull().references(() => categories.id),
  subcategoryId: uuid('subcategory_id').references(() => subcategories.id),
  source: text('source').notNull(), // 'plaid_auto' | 'user_defined'
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})

export const manualTransactions = pgTable('manual_transactions', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull().references(() => authUsers.id),
  amount: numeric('amount', { precision: 12, scale: 2 }).notNull(),
  type: text('type').notNull(), // 'expense' | 'income'
  categoryId: uuid('category_id').references(() => categories.id),
  subcategoryId: uuid('subcategory_id').references(() => subcategories.id),
  date: date('date').notNull(),
  note: text('note'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
})

export const transactionOverrides = pgTable('transaction_overrides', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull().references(() => authUsers.id),
  plaidTransactionId: text('plaid_transaction_id').notNull(),
  categoryId: uuid('category_id').references(() => categories.id),
  subcategoryId: uuid('subcategory_id').references(() => subcategories.id),
  /** User-written description shown in place of Plaid's merchant name; null = no override. */
  note: text('note'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  uniqueTransactionOverride: unique().on(table.userId, table.plaidTransactionId),
}))

// Budgets are monthly and EFFECTIVE-DATED: one row per (category, month-it-took-effect), and a
// viewed month resolves each category's latest row with effective_month <= that month. Editing an
// amount inserts a new row for the current month instead of rewriting the past, so July still
// shows the budget that was in force in July. A NULL amount is a tombstone ("stopped budgeting
// this from here on"). `period` is legacy — pre-migration rows were normalized to monthly and the
// column stays only so old clients keep working.
export const budgets = pgTable('budgets', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull().references(() => authUsers.id),
  categoryId: uuid('category_id').notNull().references(() => categories.id),
  amount: numeric('amount', { precision: 12, scale: 2 }),
  period: text('period').notNull().default('monthly'),
  effectiveMonth: date('effective_month').notNull().default(sql`date_trunc('month', now())::date`),
  /** Notify when spend crosses this percent of the budget (1-100); null = no alert. */
  alertThreshold: integer('alert_threshold'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  uniqueCategoryMonth: unique().on(table.userId, table.categoryId, table.effectiveMonth),
}))

// A transfer between the user's own accounts (or a credit card payment) shows up twice in the
// feed — once as an expense on the source account, once as income on the destination. Both legs
// are excluded from spend/income totals.
//
// Every kind of link between two transactions lives here, reimbursements included: this table
// replaced the original `reimbursements` one, which is why `kind` carries 'reimbursement' and why
// the expense-side unique indexes below exempt it. The income leg is OPTIONAL — a transfer to an
// account the user hasn't connected has no second leg to link.
export const transfers = pgTable('transfers', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull().references(() => authUsers.id),
  kind: text('kind').notNull(),
  // 'manual' = created through the TransferSheet; 'auto' = created by transfer auto-detection
  // (docs/credit-card-payment-auto-transfer.md). Lets the UI badge auto matches and offer undo.
  source: text('source').notNull().default('manual'),
  expensePlaidTransactionId: text('expense_plaid_transaction_id'),
  // Cascade: deleting a manual transaction must not be blocked by the transfer row that
  // references it. Removing a leg removes the transfer entirely, which is what unmarking
  // means anyway.
  expenseManualTransactionId: uuid('expense_manual_transaction_id').references(() => manualTransactions.id, { onDelete: 'cascade' }),
  incomePlaidTransactionId: text('income_plaid_transaction_id'),
  incomeManualTransactionId: uuid('income_manual_transaction_id').references(() => manualTransactions.id, { onDelete: 'cascade' }),
  amount: numeric('amount', { precision: 12, scale: 2 }).notNull(),
  note: text('note'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  expenseXor: check(
    'transfer_expense_xor',
    sql`(${table.expensePlaidTransactionId} IS NOT NULL) <> (${table.expenseManualTransactionId} IS NOT NULL)`,
  ),
  // At most one — both null is the valid "unpaired transfer" case.
  incomeNotBoth: check(
    'transfer_income_not_both',
    sql`NOT (${table.incomePlaidTransactionId} IS NOT NULL AND ${table.incomeManualTransactionId} IS NOT NULL)`,
  ),
  // Kept in sync with TRANSFER_KINDS in lib/transfers/kinds.ts by a test in kinds.test.ts.
  // The literals are inlined rather than imported because drizzle-kit loads this file through
  // CJS and cannot resolve the ESM '.js' specifier the rest of the backend uses.
  kindValid: check('transfer_kind_valid', sql`${table.kind} IN ('account_transfer', 'credit_card_payment', 'refund', 'reimbursement')`),
  // Kept in sync with TRANSFER_SOURCES in lib/transfers/kinds.ts by a test in kinds.test.ts;
  // literals inlined for the same drizzle-kit CJS reason as transfer_kind_valid above.
  sourceValid: check('transfer_source_valid', sql`${table.source} IN ('manual', 'auto')`),
  // Partial uniques so no transaction can be pulled into two transfers from either side.
  // Reimbursements are excluded on both sides: one expense can be paid back by several incomes,
  // and one income can be split across several expenses (each row's amount is that pair's share).
  // The app keeps a reimbursement leg out of other transfer kinds (lib/transfers/candidates.ts).
  expensePlaidUnique: uniqueIndex('transfers_expense_plaid_unique')
    .on(table.userId, table.expensePlaidTransactionId)
    .where(sql`${table.expensePlaidTransactionId} IS NOT NULL AND ${table.kind} != 'reimbursement'`),
  expenseManualUnique: uniqueIndex('transfers_expense_manual_unique')
    .on(table.userId, table.expenseManualTransactionId)
    .where(sql`${table.expenseManualTransactionId} IS NOT NULL AND ${table.kind} != 'reimbursement'`),
  incomePlaidUnique: uniqueIndex('transfers_income_plaid_unique')
    .on(table.userId, table.incomePlaidTransactionId)
    .where(sql`${table.incomePlaidTransactionId} IS NOT NULL AND ${table.kind} != 'reimbursement'`),
  incomeManualUnique: uniqueIndex('transfers_income_manual_unique')
    .on(table.userId, table.incomeManualTransactionId)
    .where(sql`${table.incomeManualTransactionId} IS NOT NULL AND ${table.kind} != 'reimbursement'`),
}))

// Remembers that the user unmarked a transfer on this expense leg, so auto-detection never
// re-creates the pair on the next scan (the scan is otherwise idempotent and would resurrect
// it every sync). Plaid ids only: auto-detection never touches manual transactions. Keyed on
// the expense (outflow) leg — the stable anchor; the income leg it pairs with may change.
// The full (non-partial) unique index is what lets creation be an ON CONFLICT-ignoring upsert.
/**
 * User-chosen display order for accounts, one row per positioned account.
 *
 * Keyed by Plaid's `account_id` because accounts are never persisted here — accounts.list
 * fetches them live per item, so there is no local row to hang a position off. The
 * consequence is that relinking an institution mints new account_ids and those accounts
 * lose their position (they sort last again); the orphaned rows are harmless and ignored
 * on read.
 *
 * `position` is only meaningful WITHIN an account's group (cash / investment / credit) —
 * groups are derived from Plaid's type at render time, not stored, so nothing here needs
 * to know which group a row belongs to.
 */
export const accountOrders = pgTable('account_orders', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull().references(() => authUsers.id),
  accountId: text('account_id').notNull(),
  position: integer('position').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  uniquePerUser: uniqueIndex('account_orders_unique').on(table.userId, table.accountId),
}))

export const transferDismissals = pgTable('transfer_dismissals', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull().references(() => authUsers.id),
  expensePlaidTransactionId: text('expense_plaid_transaction_id').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  uniquePerUser: uniqueIndex('transfer_dismissals_unique').on(table.userId, table.expensePlaidTransactionId),
}))
