# Design: Transaction groups

Status: proposal · Scope: let the user put expenses and incomes (Venmo, Zelle, cash) under a named
**group** (a trip, a night out, a shared dinner), see them together, and mark the group resolved
once everyone has paid them back. Lives in the Calendar tab.

Mockups: the "Transaction Groups" design canvas (4 screens). Screen numbers below refer to it.

## Problem

Shared spending is spread across days, accounts and categories, and so are the Venmos and Zelles
that pay it back. Nothing in ToFi today shows a trip as one thing, so the user can't easily see:

- what the whole trip cost them once friends paid them back;
- which trips are still waiting on money.

## Concepts

| Term | Meaning |
|---|---|
| **Group** | A named set of transactions. Name, colour, icon. |
| **Member** | A transaction in a group: an expense or an income. A transaction belongs to **at most one** group. |
| **Out / In / Net** | Sum of member expenses / sum of member incomes / `In − Out`. Net is what the group cost the user. |
| **Group dates** | First to last **expense** date. Incomes never stretch the range. |
| **Active** | Default for a new group. Shown in the Groups card, its transactions kept out of the day cards. |
| **Resolved** | The user tapped "Mark resolved". Shown as one row on the Calendar, worth Net, on the group's **last expense date** (last member date if it has no expenses). |

Status is set **by hand**: the app does not try to work out whether everyone has paid. The group
page shows Out / In / Net, which is enough for the user to judge. "Reopen" moves a resolved group
back to Active.

## Data model

Two new tables. Only IDs and names the user entered are stored, which keeps the
"raw financial data never persists" rule (`docs/architecture.md`, constraint 4).

```sql
CREATE TABLE transaction_groups (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid NOT NULL REFERENCES auth.users(id),
  name         text NOT NULL,
  color        text NOT NULL,          -- hex, same convention as categories.color
  icon         text,                   -- icon slug, same set as categories
  resolved_at  timestamptz,            -- null = Active
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE transaction_group_members (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id                uuid NOT NULL REFERENCES auth.users(id),
  group_id               uuid NOT NULL REFERENCES transaction_groups(id) ON DELETE CASCADE,
  plaid_transaction_id   text,         -- same id space transfers' *_plaid_transaction_id uses
  manual_transaction_id  uuid REFERENCES manual_transactions(id) ON DELETE CASCADE,
  created_at             timestamptz NOT NULL DEFAULT now(),
  CHECK ((plaid_transaction_id IS NOT NULL) <> (manual_transaction_id IS NOT NULL))
);
-- One group per transaction.
CREATE UNIQUE INDEX ON transaction_group_members (user_id, plaid_transaction_id)  WHERE plaid_transaction_id IS NOT NULL;
CREATE UNIQUE INDEX ON transaction_group_members (user_id, manual_transaction_id) WHERE manual_transaction_id IS NOT NULL;
```

Both tables get the user-scoped RLS policy every other table has (`auth.uid() = user_id`).

Whether a member is an expense or an income is not stored; it comes from the transaction's sign in
the feed, like everywhere else.

### What cannot be a member

- Transfer legs (`account_transfer`, `credit_card_payment`) and swept/excluded rows. They are not
  spending or income, and putting them in a group would make its totals wrong. They get no
  checkbox in select mode.

### Keeping IDs valid

- **Pending to posted.** When a pending Plaid transaction settles, it gets a new ID.
  `transactions.migrateIds` already repoints `transaction_overrides` and `transfers`; it must also
  repoint `transaction_group_members.plaid_transaction_id`. Without this, every transaction added
  to a group while still pending would drop out of the group on settlement.
- **Retraction.** A member whose Plaid transaction is explicitly `removed` (not merely absent from
  the cache) is deleted, following the event-driven rule in `lib/transfers/orphanCleanup.ts`.
  Absence alone is never evidence.
- **Manual delete.** `ON DELETE CASCADE` removes the member row.
- **Deleting a group** removes its member rows only. The transactions are untouched.

## Effect on existing totals

- **Home, budgets and category totals: unchanged.** Each member keeps its own category and date
  there. Groups do not net incomes against expenses for budgets; the existing reimbursement link is
  still the way to do that, and it works the same whether or not the transactions are grouped.
- **Calendar day totals and shading follow the rows on screen.** Day IN/OUT, day shading
  (`daySquares.ts`) and the Calendar's month total count only what the day cards show (UI §2):
  - **Active group:** its members are not in the day cards, so they count nowhere on the Calendar
    yet. They are visible in the Groups card and on the group page.
  - **Resolved group:** counts once, as its Net, on its last expense date. A trip stays in the
    month it happened even if the last Venmo came in the next month.

## API

New tRPC router `transactionGroups` (`backend/src/routers/transactionGroups.ts`), all
`protectedProcedure`, with a user-scoped repository like the other CRUD routers:

| Procedure | Input | Notes |
|---|---|---|
| `list` | – | Groups plus their member rows. The client derives everything else. |
| `create` | name, color, icon, members[] | members: `{ plaidTransactionId \| manualTransactionId }`. One transaction. |
| `update` | id, name?, color?, icon? | |
| `delete` | id | |
| `addMembers` | groupId, members[] | Fails with a clear error if any transaction is already in another group, naming it. |
| `removeMembers` | groupId, member ids[] | |
| `resolve` / `reopen` | id | Sets / clears `resolved_at`. |

## Client derivation

`frontend/lib/groups/groupSummary.ts`, pure and unit-tested like `aggregateMonth.ts`:

```ts
groupSummary(group, members, feedById) => {
  items: FeedItem[],            // members found in the feed, date-sorted
  out, in, net,                 // from each item's own amount (see below)
  firstDate, lastDate,          // expense dates only
  status: 'active' | 'resolved',
  calendarRow,                  // { date: lastDate, amount: net } when resolved, else null
}
```

Out and In use each transaction's **raw amount**, not `netAmount`. If a grouped expense also has a
reimbursement link to a grouped Venmo, using `netAmount` would count the payback twice.

Hook: `useTransactionGroups()` (query + mutations, same pattern as `useTransfers`). The feed
resolver adds `groupId` to each `FeedItem` so the Calendar can pull members out without a second
lookup.

For the Calendar, a step after the feed is resolved (`lib/groups/calendarFeed.ts`):
- drops every member of an **Active** group;
- replaces the members of each **Resolved** group with one synthetic `FeedItem`
  (`source: 'group'`, `id: group:<groupId>`, `date: lastDate`, `amount: −net`, category none).

Everything downstream (`groupByDay`, `dayTotals`, `daySquares`, the calendar filter) then works
unchanged. Only the Calendar tab applies this step; Home, budgets and category screens use the
plain feed.

## UI

### 1. Calendar tab: Groups card (screens 1, 4)

A card above the first day card, scrolling with the list.

- **Active groups only, in every month, until resolved.** One from an earlier month shows a
  "From November" tag next to its dates.
- **Each row:** icon, name, dates and transaction count on one line, Net (e.g. −$759)
  under it, and a `›` chevron at the right so it reads as tappable. Tap opens the group page.
- **Totals are always whole-group,** never the visible month's slice.
- Hidden when there are no Active groups. No Resolved list: a resolved group leaves this card and
  becomes one row in the day cards (§2).
- The Calendar filter does not hide the card; the day cards follow the filter as today.

### 2. Day cards (screens 1, 4)

**Active group: not in the day cards.**
- Its transactions are left out of the day cards entirely, until it is resolved.
- Adding a transaction to a group removes it from its day card at once; removing it from the
  group puts it back.

**Resolved group: one row on its last expense day.**
- In place of all its members, a single row styled like a transaction: group icon with a small
  green check, the group name, "Resolved · 3 transactions", and Net (e.g. Holiday party −$40).
  No breakdown.
- Tapping it opens the group page.
- Reopening the group takes the row away and the group goes back to the Groups card.

### 3. Calendar grid

- Active groups: a 3px underline in the group colour under each cell from the group's first to
  last expense date. This is the only mark an active group leaves on the grid.
- Resolved groups: no underline. Their only mark is the row (and its shading) on their last
  expense day.
- Two active groups on one day: the underline splits into two segments.

### 4. Creating a group and adding to one (screen 2)

- **Long-press** any eligible row on the Calendar to enter select mode. Header becomes
  "Cancel · N selected · All". Rows get checkboxes, expenses and incomes alike; ineligible rows
  (transfers, already in a group) are dimmed with no checkbox.
- **Add to group** opens a sheet: chips for "New group" and each existing group, most recent first.
  A line under the title sums the selection ("$1,120 out · $70 in").
- **New group:** just a name (colour and icon picked automatically, changeable later). Create.
- The transaction editor also gets a **Group** field (pick, change or remove), for one transaction
  at a time, which is the easy way to add a Venmo that arrives after the trip.

### 5. Group page (screen 3)

- **Header:** back, name, status pill (amber "Active" / green "Resolved"), dates, transaction count.
- **List:** every member in day cards, expenses and incomes together, rows as on the Calendar tab
  (built with `DayGroupedTransactions` on the group's items). Tapping a row opens the transaction
  editor.
- **Totals card** under the header, styled like the summary row under the Calendar tab's month
  grid (`MonthCalendar`): Income (left, `text-income`), Expenses (centre, `text-expense`),
  Balance (right, `text-textPrimary`), labels in `font-sansMed text-xs`, amounts in
  `font-display text-md` through `formatAmount`, on a `rounded-xl bg-surface` card with
  `shadow.sm`.
- **Actions:** "Add transactions" (opens select mode around the group's dates, ±7 days) and
  "Mark resolved" (or "Reopen" once resolved). Menu: Rename, Change colour, Delete group.

## Edge cases

| Case | Behaviour |
|---|---|
| Grouped transaction is later marked as a transfer | Not allowed: the transfer sheet asks to remove it from the group first. |
| Pending transaction | Can be added; the amount updates when it posts; ID migrates (see above). |
| Group with only incomes | Allowed (e.g. collecting money for a gift). Resolved row goes on its last member date and shows as income. |
| Venmo arrives after the group is resolved | User adds it through the editor's Group field. The resolved row's Net updates; the row does not move. |
| Net is positive (got back more than spent) | The resolved row shows as income (+$X). |
| Trip spans two months (Oct 30 – Nov 2) | While active: underline in both months, Groups card in both. Once resolved: one row on Nov 2. |
| Account filter on Calendar | Day cards follow it. Group totals always use every account. A resolved group's row shows when any of its members matches the filter. |
| Calendar category filter | A resolved group's row has no category; it shows when any member matches the filter, with the full Net. |
| Masked amounts | All group amounts respect the existing `$****` masking. |

## Build order

1. Migration + repository + `transactionGroups` router + RLS, with router tests.
2. Extend `transactions.migrateIds` and the orphan sweep to cover group members.
3. `groupSummary.ts` + tests (totals, raw-amount rule, dates, cross-month).
4. `useTransactionGroups`, `groupId` on `FeedItem`.
5. Group page, reachable from the transaction editor's Group field.
6. Select mode + Add to group sheet.
7. Calendar: Groups card, `calendarFeed.ts` (hide active members, one row per resolved group),
   grid underline.

Each step ships on its own; 1–5 give a working feature with the editor as the only entry point.

## Not in this version

- **Tracking who owes what** or how much is expected back. Resolving is by hand.
- **Matching paybacks to specific expenses** from the group. The existing reimbursement link
  still exists for budget netting.
- **Group budgets** ("Japan: $2,000").
- **Automatic grouping** by date range or location.
- **Nested groups.**
