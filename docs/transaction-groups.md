# Design: Transaction groups

Status: proposal · Scope: let the user gather expenses and incomes into a named **group** (a trip, a
night out, a shared dinner), see them together, and track whether the money friends owe for it has
come back. Lives in the Calendar tab.

Mockups: the "Transaction Groups" design canvas (6 screens). Screen numbers below refer to it.

## Problem

Shared spending is spread across days, accounts and categories, and so are the paybacks that follow
it. Today ToFi can link a reimbursement to an expense one pair at a time, but nothing answers the
questions the user actually has after a trip:

- What did the whole thing cost me, once everyone paid me back?
- Who still owes me, and for what?
- Which past trips are settled, and which are still waiting?

## Concepts

| Term | Meaning |
|---|---|
| **Group** | A named set of transactions. Name, colour, icon. |
| **Member** | A transaction in a group. A transaction belongs to **at most one** group. |
| **Expected back** | Per member expense: how much of it the user expects other people to repay. `0` = "just mine". |
| **Received** | Per member expense: the sum of `transfers` rows of kind `reimbursement` whose expense leg is that member. |
| **Owed** | `max(0, Σ expected − Σ received)` over the group's expenses. |
| **Your share** | `Σ expense amounts − Σ expected` — what the group costs the user once fully paid back. |
| **Group dates** | First to last **expense** date. Paybacks never stretch the range. |
| **Resolved date** | The day a group became Resolved: the date of the last payback that brought owed to $0; for "Settle anyway", the day it was settled; for a group nobody owed anything for, its last expense date. Derived, except for settling (`settled_at`). |

### Status: Active and Resolved

Status is **derived on the client, never stored**, the same way totals are
(`docs/credit-card-payment-auto-transfer.md`, "totals are derived"):

| Condition | Status |
|---|---|
| `owed > 0` and not settled | **Active** |
| `owed = 0` (everything expected has come back) | **Resolved** |
| `settled_at` is set (the user tapped "Settle anyway") | **Resolved** (shows "$X written off") |
| `Σ expected = 0` (nobody owes anything) | **Resolved** from the start |

Because it is derived, unmatching a payback or raising an expected amount reopens a group with no
extra bookkeeping. The only stored status input is `settled_at`; clearing it (the "Reopen" action)
returns the group to whatever the numbers say.

If someone overpays (`Σ received > Σ expected`), the group is Resolved and the detail page shows the
surplus. Per-expense "waiting" rows use `max(0, expected − received)` for each expense, so one
overpaid expense does not hide another's shortfall in the Matched view, but the group's status uses
the group-level totals.

## Data model

Two new tables. Only IDs and amounts the user entered are stored, which keeps the
"raw financial data never persists" rule (`docs/architecture.md`, constraints 4–5).

```sql
CREATE TABLE transaction_groups (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES auth.users(id),
  name        text NOT NULL,
  color       text NOT NULL,           -- hex, same convention as categories.color
  icon        text,                    -- icon slug, same set as categories
  settled_at  timestamptz,             -- "Settle anyway"; null = status follows the numbers
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE transaction_group_members (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id                uuid NOT NULL REFERENCES auth.users(id),
  group_id               uuid NOT NULL REFERENCES transaction_groups(id) ON DELETE CASCADE,
  plaid_transaction_id   text,         -- same id space transfers' *_plaid_transaction_id uses
  manual_transaction_id  uuid REFERENCES manual_transactions(id) ON DELETE CASCADE,
  expected_back          numeric(12,2) NOT NULL DEFAULT 0,   -- ignored for income members
  created_at             timestamptz NOT NULL DEFAULT now(),
  CHECK ((plaid_transaction_id IS NOT NULL) <> (manual_transaction_id IS NOT NULL)),
  CHECK (expected_back >= 0)
);
-- One group per transaction.
CREATE UNIQUE INDEX ON transaction_group_members (user_id, plaid_transaction_id)  WHERE plaid_transaction_id IS NOT NULL;
CREATE UNIQUE INDEX ON transaction_group_members (user_id, manual_transaction_id) WHERE manual_transaction_id IS NOT NULL;
```

Both tables get the user-scoped RLS policy every other table has (`auth.uid() = user_id`).

### Which incomes are in a group

- **Paybacks join automatically.** An income linked by a `reimbursement` transfer to a member
  expense is shown as part of that group, with no member row of its own. Membership of paybacks is
  derived from `transfers`, so there is one source of truth for "this Venmo paid back that
  Airbnb".
- **Other incomes can be added explicitly** (selling leftover lift tickets, a refund from the
  Airbnb host). They get a member row with `expected_back = 0`. They count toward the group's
  In/Out and net, not toward Received or Owed.
- An income that is a payback for a member of group A cannot be an explicit member of group B.

### What cannot be a member

- Transfer legs (`account_transfer`, `credit_card_payment`) and swept/excluded rows. They are not
  spending, and putting them in a group would make its totals wrong. They are hidden from the
  select-mode checkboxes.
- `refund` transfers are allowed as explicit income members, since a refund is part of what a trip
  cost.

### Keeping IDs valid

- **Pending to posted.** When a pending Plaid transaction settles, it gets a new ID.
  `transactions.migrateIds` already repoints `transaction_overrides` and `transfers`; it must also
  repoint `transaction_group_members.plaid_transaction_id`. Without this, every expense added to a
  group while still pending would drop out of the group on settlement.
- **Retraction.** A member whose Plaid transaction is explicitly `removed` (not merely absent from
  the cache) is deleted, following the event-driven rule in `lib/transfers/orphanCleanup.ts`.
  Absence alone is never evidence.
- **Manual delete.** `ON DELETE CASCADE` removes the member row.
- **Deleting a group** removes its member rows only. Transactions and reimbursement links are
  untouched.

## Effect on existing totals

- **Category and budget totals: unchanged.** Each member keeps its own category and date there.
  Reimbursement netting already happens through `transfers` (`netAmount`, `isReimbursementIncome`
  in `lib/transactions/totals.ts`), and matching a payback through a group creates exactly those
  rows. A resolved group has no single category, so it cannot be one row in a budget.
- **Calendar day totals and day shading: a resolved group moves to its resolved date.** On the
  Calendar a resolved group is one row (see UI §2), so its members leave their own days and the
  row's amount (your share, i.e. the group's net) counts on the resolved date instead. Day
  IN/OUT, day shading (`daySquares.ts`) and the Calendar's month total follow the rows on screen.
  Consequence: a November trip resolved on Dec 2 disappears from November's Calendar and shows as
  one row in December. Home and category screens are not affected.
- While a group is Active nothing moves: every member shows and counts on its own day.

## API

New tRPC router `transactionGroups` (`backend/src/routers/transactionGroups.ts`), all
`protectedProcedure`, with a user-scoped repository like the other CRUD routers:

| Procedure | Input | Notes |
|---|---|---|
| `list` | – | Groups plus their member rows. The client derives everything else. |
| `create` | name, color, icon, members[] | members: `{ plaidTransactionId \| manualTransactionId, expectedBack }`. One transaction. |
| `update` | id, name?, color?, icon? | |
| `delete` | id | |
| `addMembers` | groupId, members[] | Fails with a clear error if any transaction is already in another group, naming it. |
| `removeMembers` | groupId, member ids[] | |
| `setExpectedBack` | member id, amount | |
| `settle` / `reopen` | id | Sets / clears `settled_at`. |

Matching a payback uses the existing `transfers.createMany` (kind `reimbursement`, one row per
expense share, the split-income case already supported). No new endpoint is needed for it.

## Client derivation

`frontend/lib/groups/groupSummary.ts`, pure and unit-tested like `aggregateMonth.ts`:

```ts
groupSummary(group, members, feedById, transfers) => {
  expenses: Array<{ item, expectedBack, paybacks: Array<{ item, amount }>, waiting }>,
  otherIncome: FeedItem[],
  out, in, net,                 // net = in − out
  expected, received, owed, yourShare, surplus,
  firstDate, lastDate,          // expense dates only
  status: 'active' | 'resolved',
  resolvedDate,                 // null while active
  calendarRow,                  // { date: resolvedDate, amount: net } when resolved, else null
  writtenOff,                   // owed at the moment of settling, when settled
}
```

Hook: `useTransactionGroups()` (query + mutations, same pattern as `useTransfers`). The feed
resolver adds `groupId` to each `FeedItem` (direct member, or derived through a reimbursement link)
so day cards can nest rows without a second lookup.

For the Calendar, a step after the feed is resolved replaces the members of each resolved group
with one synthetic `FeedItem` (`source: 'group'`, `id: group:<groupId>`, `date: resolvedDate`,
`amount: −net`, category none). Everything downstream (`groupByDay`, `dayTotals`, `daySquares`,
the calendar filter) then works unchanged. Only the Calendar tab applies this step; Home, budgets
and category screens use the plain feed.

## UI

### 1. Calendar tab: Groups card (screens 1, 6)

A card above the first day card, scrolling with the list.

- **Header:** "Groups" and "$X still owed to you" (sum of owed across Active groups).
- **Active groups only, in every month, until resolved.** They are a to-do list. One from an
  earlier month shows a "From November" tag next to its dates. Each row: icon, name, dates, number
  of friends if split evenly, "$350 owed", "$490 of $840 back" and a progress bar. Tap opens the
  group.
- **No Resolved list.** When a group resolves it leaves this card and becomes one row in the day
  cards (§2).
- **Totals on the card are always whole-group,** never the visible month's slice.
- Hidden when there are no Active groups.
- The Calendar filter keeps working: with a filter on, the card still shows (groups are not
  filtered), but the day cards follow the filter as today.

### 2. Day cards (screens 1, 6)

**Active group: rows stay on their own day, nested.**
- A group's rows for a day sit together under a small header: group colour tint, name in caps
  and member count, then "Open ›" or that group's owed amount. A left rule in the group colour
  marks the nested rows.
- On a day outside the group's dates (a later payback), the header shows the dates
  ("TAHOE SKI TRIP · NOV 14–16") so it's clear which earlier trip the money belongs to.
- The day's IN/OUT header counts everything on the day, as today.
- Tapping the group header opens the group; tapping a row opens the transaction editor as today.

**Resolved group: one row on its resolved date.**
- All its members (expenses, paybacks, other income) leave their own days. In their place is a
  single row on the resolved date, styled like a transaction: group icon with a small green check,
  the group name, "Resolved · Dec 5 · 3 transactions" (the group dates and member count), and
  the net amount (your share, e.g. −$40). No nested rows, no breakdown.
- Tapping it opens the group page (Timeline view).
- Reopening a group (unmatching a payback, raising an expected amount, clearing "Settle anyway")
  puts its members back on their own days.

### 3. Calendar grid

- Active groups: a 3px underline in the group colour under each cell from the group's first to
  last expense date. Payback days get no underline; their green shading already shows income.
- Resolved groups: no underline. Their only mark is the row (and its shading) on the resolved date.
- Two active groups on one day: the underline splits into two segments.

### 4. Creating a group and adding to one (screen 2)

- **Long-press** any eligible row on the Calendar to enter select mode. Header becomes
  "Cancel · N selected · All". Rows get checkboxes; ineligible rows (transfers, already in a group)
  are dimmed with no checkbox.
- **Add to group** opens a sheet: chips for "New group" and each existing group, most recent first.
- **New group** fields: Name, then "Expecting money back?"
  - **No:** every expense gets `expected_back = 0`.
  - **Split evenly** with an N-people stepper (default 2, you included): each expense gets
    `amount × (N−1)/N`, rounded to cents. The sheet previews "You'll be owed $840 of $1,120".
  - **Custom:** a list of the selected expenses with an amount field each.
- Adding to an **existing** group: if it was created with Split evenly, new expenses default to the
  same N; otherwise to `0`. Editable afterwards on the group page.
- The transaction editor also gets a **Group** field (pick, change or remove), for one transaction
  at a time.

### 5. Group page (screens 3, 4)

- **Header:** back, name, status pill (amber "Active" / green "Resolved"), dates, transaction count.
- **Summary card:** "Still owed to you $350" with a progress bar ($490 back of $840 expected), then
  Spent, Back so far, Your share. Resolved shows "All paid back" (or "$X written off") instead.
- **Matched / Timeline** switch. Default is Matched while Active, Timeline once Resolved.
  - **Matched:** one card per expense with its paybacks nested under it ("Alice Chen · Venmo +$210").
    If one payment is split across expenses, each part shows "$24 of a $70 payment". A dashed
    "Waiting on $210 · Match payment" row appears while that expense is short. Expenses with
    `expected_back = 0` say "just yours". Explicit income members appear in an "Other income" card
    at the end.
  - **Timeline:** every group transaction, expenses and incomes together, by day, using the same
    day cards. Days after the last expense sit under an "After the trip" divider. A floating bar
    shows Out / In / Net.
- **Actions:** Add transactions (opens select mode scoped to the group's dates, ±3 days),
  Settle anyway (confirm: "Write off $350? The group will be marked resolved."), and in the menu
  Rename, Change colour, Reopen (if settled), Delete group.
- Tapping an expense allows editing its expected-back amount.

### 6. Matching a payback (screen 5)

Entry points: the dashed "Match payment" row on the group page, and a suggestion on an incoming
transaction.

- **Suggestion:** an income that is not yet linked, dated on or after an Active group's first date,
  shows "Looks like a payback" in its detail sheet, with chips for Active groups ("Tahoe ski trip ·
  $350 owed"). Candidates are found with the existing reimbursement-candidate rules
  (`lib/transfers/candidates.ts`). P2P incomes (Venmo, Zelle, Cash App) rank first.
- **Allocation:** picking a group lists its expenses that are still waiting, pre-filled oldest
  first until the payment runs out. Each amount is editable. A counter shows "$350 of $350
  assigned"; Match is disabled while it is over the payment amount.
- **Preview:** if the match brings owed to $0, a green note says "Tahoe ski trip will be resolved"
  and that it becomes one row on the payback's date with the final share.
- **Match** creates one `reimbursement` transfer per allocated expense. "Not a payback" hides the
  suggestion for that transaction.
- From "Match payment" on the group page, the flow runs the other way: pick the incoming payment
  from candidates, then the same allocation screen.

## Edge cases

| Case | Behaviour |
|---|---|
| Expense in a group is later marked as a transfer | Not allowed: the transfer sheet asks to remove it from the group first. |
| Payback is unlinked | Group recomputes; may return to Active. |
| Expected back > expense amount | Rejected in the UI (max = amount). |
| Pending expense | Can be added; the amount updates when it posts; ID migrates (see above). |
| Group with only incomes | Allowed (e.g. collecting money for a gift). Status follows the rules: no expected → Resolved. |
| Masked amounts | All group amounts respect the existing `$****` masking. |
| Account filter on Calendar | Day cards follow it. Group totals and status always use every account: a group is about the money, not the account. A resolved group's row shows when any of its members matches the filter. |
| Calendar category filter | A resolved group's row has no category; it shows when any member matches the filter, with the full group net. |
| Resolved in a later month | The group leaves the earlier month's Calendar entirely and appears as one row in the month of its resolved date. |

## Build order

1. Migration + repository + `transactionGroups` router + RLS, with router tests.
2. Extend `transactions.migrateIds` and the orphan sweep to cover group members.
3. `groupSummary.ts` + tests (status, owed, overpayment, settle, cross-month dates).
4. `useTransactionGroups`, `groupId` on `FeedItem`.
5. Group page (Matched + Timeline), reachable from the transaction editor's Group field.
6. Select mode + Add to group sheet.
7. Calendar: Groups card, nested day-card rows for active groups, the resolved-group row
   (synthetic feed item), grid underline.
8. Payback suggestion + allocation sheet.

Each step ships on its own; 1–5 give a working feature with the editor as the only entry point.

## Not in this version

- **Per-person tracking** ("Chris owes $280"). Expected back is per expense, not per person. If
  added later, members would gain an optional list of `{ person, amount }` and status would not
  change.
- **Money the user owes others** (a friend paid the Airbnb). Needs a manual "IOU" entry; out of
  scope.
- **Group budgets** ("Japan: $2,000").
- **Automatic grouping** by date range or location.
- **Nested groups.**
