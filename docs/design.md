# ToFi — Design System & UI Spec
> Agent context document. Read before writing any component code. Pairs with `product.md` (features) and `architecture.md` (backend/data layer).

Reference app: 记账本 (Chinese budgeting app). ToFi takes the same structural ideas — pastel category cards, teal brand hero, calendar transaction view — and adapts them to a **light-mode-first, premium fintech aesthetic** for a young urban audience.

> **2026-08 update:** pivoted from an earlier dark-mode-first draft of this spec to light-mode-first, moving closer to 记账本's actual light aesthetic per direct reference screenshots — warm near-white surfaces, fully-saturated pastel category cards (not a subtle dark-card tint), and AA-contrast-safe deep shades for semantic text colors. Structure, typography, and layout are unchanged; this was a color-token-level pivot. See `.impeccable.md` for the full design-context note.

---

## Design Principles

- **Numbers first.** Financial amounts are the primary content. They get the largest type, monospaced digits, and the most visual weight on every screen.
- **Color encodes health.** Teal = on track. Amber = approaching limit. Rose = over budget. This system is consistent across every surface — cards, progress bars, ring indicators, badges.
- **Category cards are the signature element.** Each card has an animated arc ring around its icon that fills to show budget utilization. The ring color shifts teal → amber → rose. At a glance, a user sees both spend amount and budget health without reading any text label.
- **Reimbursements are first-class.** They appear as a distinct green row type in transaction lists, not buried or treated as a generic income entry.
- **Privacy by default.** Sensitive amounts can be masked with a single tap. Masked state shows `$****`.
- **Credentials are never displayed in plaintext after entry.** The one screen in the app that touches a secret (Plaid Developer Account) treats it like a password field, everywhere, always.

---

## Color Tokens

All values map 1:1 to `constants/theme.ts`. No hex values should appear anywhere else in the codebase.

### Base Palette

```
background       #FAFAF8    App background (warm near-white, never pure #FFF)
surface          #FFFFFF    Cards, sheets, bottom sheets
surfaceRaised    #F3F3EF    Elevated elements, dropdowns, modals, pressed states
border           #E8E8E2    Dividers, input borders
borderStrong     #D3D3CA    Stronger dividers, focused inputs
```

### Brand

```
primary          #0F766E    Teal — brand color, active states, CTAs, links (AA-safe as text on background/surface)
primaryDim       #0B5C56    Darker teal — pressed states
primaryMuted     rgba(15,118,110,0.10)   Teal tint surface (hero card wave, highlights, selected segment bg)
```

### Semantic

These double as both icon color and text color throughout the codebase (error text, status labels, amounts) — each is a deep, AA-contrast-safe shade against `background`/`surface`, not the brighter tone you'd reach for on a dark card.

```
income           #059669    Emerald — income amounts, positive deltas, reimbursement rows
expense          #E11D48    Rose — expense amounts, over-budget states
warning          #B45309    Amber — approaching budget (70–90%)
reimbursed       #7C3AED    Violet — reimbursement badge, partial reimbursement indicator
```

### Text

```
textPrimary      #1C1C18    Primary text (warm near-black, never pure #000)
textSecondary    #6E6E64    Secondary labels, metadata
textMuted        #A8A89C    Placeholder, disabled text
textInverse      #FFFFFF    Text on filled teal/dark surfaces (buttons, hero card)
```

### Category Card Tints

Each category has a `color` stored in the DB (user-defined hex). The card surface and icon ring are derived from it at render time — pastel fills should read as genuinely colored cards (like the 记账本 reference), not a near-invisible tint on a dark card:

```ts
// Given category.color = '#F97316' (orange):
cardSurface  = hexToRgba(category.color, 0.16)   // saturated pastel bg — the card's defining color
iconRing     = category.color                      // full color ring around icon
iconBg       = hexToRgba(category.color, 0.28)    // more-saturated inner circle behind the icon (two-tone badge)
```

Default category colors (seeded on onboarding):

```
Food & Drink     #F97316    Orange
Transport        #3B82F6    Blue
Travel           #8B5CF6    Violet
Entertainment    #EC4899    Pink
Shopping         #EAB308    Yellow
Bills            #6B7280    Gray
Health           #10B981    Emerald
Personal Care    #F43F5E    Rose
Home             #84CC16    Lime
Services         #06B6D4    Cyan
Income           #34D399    Emerald (same as semantic income)
Transfers In     #2DD4BF    Teal
Transfers Out    #9CA3AF    Cool gray
Loans            #F87171    Soft red
Fees             #6B7280    Gray
Other            #71717A    Zinc
```

---

## Typography

```ts
fontFamily = {
  display:  'DMSans_700Bold',      // large numbers, hero amounts
  sans:     'Inter_400Regular',    // body text, labels
  sansMed:  'Inter_500Medium',     // slightly emphasized labels
  sansSemi: 'Inter_600SemiBold',   // section headers, card titles
  mono:     'JetBrainsMono_400Regular', // transaction amounts in lists
}

fontSize = {
  xs:   11,   // timestamps, fine print
  sm:   13,   // metadata, secondary labels
  base: 15,   // body, list items
  md:   17,   // primary labels, card amounts
  lg:   22,   // section totals
  xl:   28,   // screen-level totals
  '2xl': 36,  // hero amounts (net worth, monthly spend)
  '3xl': 48,  // large hero display
}
```

**Usage rules:**
- All monetary amounts in lists → `fontFamily.mono`, so digits align vertically when amounts differ in length
- Hero/summary amounts → `fontFamily.display`
- UI labels, descriptions → `fontFamily.sans` / `fontFamily.sansMed`
- Section headers → `fontFamily.sansSemi`
- Credential inputs (Client ID, Secret) → `fontFamily.mono`, so long alphanumeric strings are easy to visually verify character-by-character

**No dot separators.** Never join two pieces of text with ` · ` (or `•`, `|`, `—` used the same way) — "Use $2,260 · 3-month average" reads as two captions glued together. Separate them with layout instead: put them in their own `Text` elements with a gap between, and let weight and colour say which is primary (`sansSemi`/`textPrimary` for the action or figure, `sansMed`/`textSecondary` for its context). If two facts don't fit side by side, stack them, or drop the less important one.

---

## Spacing & Layout

```ts
spacing = {
  1:  4,
  2:  8,
  3:  12,
  4:  16,
  5:  20,
  6:  24,
  8:  32,
  10: 40,
  12: 48,
}

borderRadius = {
  sm:   8,
  md:   14,
  lg:   20,
  xl:   28,
  full: 9999,
}
```

- Screen horizontal padding: `spacing[5]` (20px) on all screens
- Card inner padding: `spacing[4]` (16px)
- Between cards in a grid: `spacing[3]` (12px) gap
- Section spacing: `spacing[8]` (32px) between major sections

---

## Shadows

On light surfaces, shadows should read as soft elevation, not heavy drop-shadows — low opacity, black for ordinary cards, a teal tint reserved for the hero card's subtle glow:

```ts
shadow = {
  sm: { shadowColor: '#000', shadowOffset: {width:0, height:2}, shadowOpacity:0.06, shadowRadius:6, elevation:2 },
  md: { shadowColor: '#000', shadowOffset: {width:0, height:6}, shadowOpacity:0.1, shadowRadius:14, elevation:4 },
  card: { shadowColor: '#0F766E', shadowOffset: {width:0, height:4}, shadowOpacity:0.1, shadowRadius:20, elevation:3 },
}
```

---

## Core Components

### CategoryCard

The signature UI element. Used on Dashboard and Budget screens.

```
┌─────────────────────┐
│  Food & Drink       │  ← category name, sansSemi, textSecondary, sm
│                     │
│      ╭───╮          │
│    ──┤ 🍽 ├──        │  ← arc ring (SVG): colored, partial fill = budget %
│      ╰───╯          │     ring color: teal(<70%) amber(70-90%) rose(>90%)
│                     │
│     $127.40         │  ← amount, display font, textPrimary, lg
│   of $200 budget    │  ← only shown if budget set, textMuted, xs
└─────────────────────┘
  card surface = hexToRgba(category.color, 0.10)
  border = hexToRgba(category.color, 0.20)
  borderRadius = lg (20)
```

- Grid layout: 2 columns on dashboard, equal width
- No budget set: ring is static, full-circle outline in `border` color
- No transactions: show `$0` not `N/A`
- Reimbursements reduce the net amount shown on the card

### TransactionRow

```
┌──────────────────────────────────────────────────────┐
│  ╭───╮  Food & Drink          -$35.50   [Chase logo] │
│  │ 🍽 │  Lunch · Mr Q         mono, rose             │
│  ╰───╯  textSecondary, sm                            │
└──────────────────────────────────────────────────────┘
```

- Icon circle: 40px, `hexToRgba(category.color, 0.18)` bg, colored icon
- Category name: `sansSemi`, `textPrimary`, base
- Subcategory · Merchant: `sans`, `textSecondary`, sm — on second line
- Amount: `mono`, right-aligned — `expense` color for debits, `income` for credits
- Account logo: 18px icon, far right, `textMuted` tint
- Reimbursement row variant: violet icon, `+$XX` in `income` color, label "Reimbursement · [linked category]"
- Partial reimbursement: show net amount with `reimbursed` badge: `[$35.50 → $5.50]`
- Manual transaction variant: same layout, but small ✏️ pencil badge on the icon circle bottom-right corner to indicate user-entered (not from Plaid)

### HeroCard (Accounts screen)

```
┌──────────────────────────────────────────────────────┐
│  👁  Net Worth                              📈        │
│                                                      │
│              $12,847.29                              │  ← display font, 3xl, white
│           ~~~wave SVG~~~                             │
│   Total Assets          Total Liabilities            │
│   $18,200               $5,352                       │
└──────────────────────────────────────────────────────┘
  background: linear gradient — #1A7A70 → #0D4F4A
  wave: SVG path, primaryMuted fill, subtle animation
```

- Privacy toggle (eye icon): masks all amounts to `$****`
- Trend icon opens the net worth history sheet (`NetWorthTrendSheet`): a year navigator, a signed area chart of month-end net worth, and a newest-first list of months with their month-over-month change. Since balances are never persisted, the series is *back-cast* from today's net worth by unwinding transactions month by month — Plaid and manual alike, matching how `aggregateMonth` already counts them. See `lib/accounts/netWorthHistory.ts` for the sign convention and the one remaining limit (investment market movement is not reconstructable)
- The icon stays in its dimmed, non-interactive state when a screen renders `HeroCard` without an `onTrendPress` handler
- Balances shown here are fetched live through the backend on each view (never persisted server-side — see `architecture.md`), so this card should carry its own loading skeleton independent of the rest of the screen

### AccountRow

```
┌──────────────────────────────────────────────────────┐
│  [Chase logo]  Chase Sapphire          $4,821.00     │
└──────────────────────────────────────────────────────┘

Credit variant:
┌──────────────────────────────────────────────────────┐
│  [Amex logo]   American Express        $1,240.00     │
│                                        Limit $5,000  │  ← textMuted, sm
└──────────────────────────────────────────────────────┘
```

- Institution logo: 32px rounded square
- Credit accounts show balance in `expense` color + limit in `textMuted`
- Cash/investment accounts show balance in `textPrimary`
- `cashOnHand` variant: the built-in **Cash** row, always present at the end of the Cash Accounts section even with nothing linked. Banknote icon in `income`, to read as distinct from a linked bank's wallet icon. Its balance is derived from manual transactions (`computeCashOnHand`) rather than a Plaid balance, and it opens the same `AccountDetailSheet` listing those transactions — which is why that sheet takes `title`/`balance`/`items` rather than an `Account`

### CalendarCell

```
┌──────┐
│  21  │  ← date, sansMed
│$66.24│  ← daily spend, mono, expense — only shown if spend > 0
└──────┘
```

- Today: `primaryMuted` background, `primary` date text
- Has spend: show amount below date in `expense` color, xs
- Has income only: show in `income` color
- Mixed: show net, color based on sign
- Empty: date only, `textMuted`
- Selected: `primary` border, `surfaceRaised` bg

### BottomSheet (Category Picker)

Used when tapping a transaction to recategorize.

```
─── drag handle ───────────────────────────────────────

  Change Category

  ┌──────────┐ ┌──────────┐ ┌──────────┐
  │   🍽     │ │   🚗     │ │   ✈️     │
  │ Food     │ │Transport │ │ Travel   │
  └──────────┘ └──────────┘ └──────────┘
  ┌──────────┐ ┌──────────┐ ┌──────────┐
  │   🎮     │ │   🛍     │ │   ...    │
  │Entertain │ │ Shopping │ │  More    │
  └──────────┘ └──────────┘ └──────────┘

  Subcategory  ───────────────────────────
  ○ Restaurants   ○ Groceries   ● Lunch
  ○ Coffee        ○ Bars

  ┌───────────────────────────────────────┐
  │            Apply to [Vendor]?         │  ← toggle
  └───────────────────────────────────────┘

                  [ Save ]
```

### SecretInput

Used only on the Plaid Developer Account screen (see Screen Layouts below), but defined as a reusable primitive since any future credential field should use the same pattern.

```
┌─────────────────────────────────────────────────┐
│  Secret                                          │
│  ••••••••••••••••••••••••••••         [ 👁 ]     │  ← mono font, textMuted dots
└─────────────────────────────────────────────────┘
```

- Default state: fully masked, monospaced dots, `textMuted`
- Tap the eye icon: reveals in plain mono text for as long as the field is focused; re-masks on blur
- Once a credential has been saved, reopening the screen never pre-fills the real secret — shows a static masked placeholder plus a "Replace" text button instead of an editable field
- Border color: `border` default, `primary` on focus, `expense` on validation failure

---

## Screen Layouts

### 1. Dashboard (Home)

```
┌─────────────────────────────────────────┐
│  Accounts ▾           < This Month >  🐷 │  ← header
│                                         │
│         Expenses  $763.54  ⌄            │  ← collapsible, expense color
│                                         │
│  ┌─────────────┐  ┌─────────────┐       │
│  │ Food & Drink│  │  Transport  │       │  ← 2-col card grid
│  │    [ring]   │  │    [ring]   │       │
│  │   $127.40   │  │    $18.00   │       │
│  └─────────────┘  └─────────────┘       │
│  ┌─────────────┐  ┌─────────────┐       │
│  │Entertainment│  │  Shopping   │       │
│  │    [ring]   │  │    [ring]   │       │
│  │    $45.00   │  │   $152.00   │       │
│  └─────────────┘  └─────────────┘       │
│                                         │
│         Income  $5,867.83  ⌄            │  ← collapsible, income color
│                                         │
│  ┌─────────────┐                        │
│  │   Income    │                        │
│  │    [ring]   │                        │
│  │ $5,867.83   │                        │
│  └─────────────┘                        │
└─────────────────────────────────────────┘
```

- Month navigator: `< This Month >` — left/right arrows page through months
- Piggy bank icon → Savings/goals (v2 feature, show as disabled in v1)
- Expense and Income sections are independently collapsible (chevron)
- Cards in a 2-column `FlatList` grid with `numColumns={2}`

### 2. Accounts

```
┌─────────────────────────────────────────┐
│  All Accounts ▾                      ＋ │
│                                         │
│  ┌─────────────────────────────────┐    │
│  │ 👁  Net Worth            📈     │    │  ← HeroCard
│  │        $12,847.29               │    │
│  │  ~~~~ wave ~~~~~~~~~~~~~~~~~~~~  │    │
│  │  Assets $18.2k   Liabilities    │    │
│  └─────────────────────────────────┘    │
│                                         │
│  CASH ACCOUNTS          Balance $****  ⌄│  ← section header, collapsible
│  ─────────────────────────────────────  │
│  [BOA]    Bank of America   $4,821      │
│  [Chase]  Chase Checking    $2,100      │
│  [Fid]    Fidelity Roth IRA $8,200      │
│                                         │
│  CREDIT ACCOUNTS        Owed $****    ⌄ │
│  ─────────────────────────────────────  │
│  [Amex]   American Express  $1,240      │
│                             Limit $5k   │
│  [GS]     Apple Card         $892       │
│                             Limit $3k   │
└─────────────────────────────────────────┘
```

- `+` button → checks whether the user has saved Plaid credentials (Settings → Plaid Developer Account); if not, routes there first with an explanatory message, otherwise triggers Plaid Link directly to add a new account
- Section balance shown in header, tap to show/hide individual amounts
- Investment accounts shown under Cash with a small chart icon indicator

### 3. Transactions

Two view modes toggled by icon buttons in the header.

**List view (default):**
```
┌─────────────────────────────────────────┐
│  Accounts ▾       < This Month >  📋 📅 │  ← 📋=list, 📅=calendar toggle
│                                         │
│  Jun 21, Sunday                 $66.24  │  ← date header + day total
│  ─────────────────────────────────────  │
│  [🍽] Food & Drink    -$12.74  [Chase]  │
│       Dinner · Panda                    │
│  [🏸] Sports          -$18.00  [Chase]  │
│       Badminton                         │
│  [🍽✏️] Food & Drink   -$5.00           │  ← manual transaction: pencil badge,
│         Street food · Cash note         │    no account logo, note shown as merchant
│  [🍽] Food & Drink    -$35.50  [Chase]  │
│       Lunch · Mr Q                      │
│  [↩️] Reimbursement   +$70.00  [Chase]  │  ← violet icon, income color amount
│       Food & Drink                      │
│                                         │
│  Jun 20, Saturday               $24.40  │
│  ─────────────────────────────────────  │
│  ...                                    │
│                                         │
│                          ╭───╮          │
│                          │ + │          │  ← FAB: Add Transaction
│                          ╰───╯          │
└─────────────────────────────────────────┘
```

**Calendar view:**
```
┌─────────────────────────────────────────┐
│  Accounts ▾       < This Month >  📋 📅 │
│                                         │
│  ┌─────────────────────────────────┐    │
│  │ Sun  Mon  Tue  Wed  Thu Fri  Sat│    │
│  │  31    1    2    3    4   5    6│    │
│  │      $36  $21       $24 $1.5k $26   │
│  │   7    8    9   10   11  12   13│    │
│  │ $41   $5 $142       $29  $15 $1.6k  │
│  │  14   15   16   17  18   19   20│   │
│  │ $85  $59  $20  $25 $2.6k $13  $24  │
│  │ [21]  22   23   24  25   26   27│   │  ← today = teal highlight
│  │ $66       *$3                        │
│  └─────────────────────────────────┘    │
│                                         │
│  Income $5,867  Expenses $763  Net $5,104│  ← summary bar
│  ─────────────────────────────────────  │
│                                         │
│  Jun 21, Sunday                 $66.24  │  ← selected day transactions
│  [🍽] Food & Drink    -$12.74  [Chase]  │
│       Dinner · Panda                    │
└─────────────────────────────────────────┘
```

- `*` prefix on calendar cell = includes a reimbursement on that day
- Tapping a day selects it and scrolls to that day's transactions below
- Summary bar: Income (emerald) / Expenses (rose) / Net (textPrimary)

### 4. Budgets

```
┌─────────────────────────────────────────┐
│  Budgets              < This Month >    │
│                                         │
│  Overall  $763 / $1,500                 │
│  ████████████████░░░░░░░░░░░  51%       │  ← teal bar
│                                         │
│  ─────────────────────────────────────  │
│                                         │
│  ┌─────────────────────────────────┐    │
│  │ [🍽]  Food & Drink              │    │
│  │       $127 / $200               │    │
│  │ ██████████████░░░░░░░  63%  ✓   │    │  ← teal, on track
│  └─────────────────────────────────┘    │
│  ┌─────────────────────────────────┐    │
│  │ [🛍]  Shopping                  │    │
│  │       $152 / $175               │    │
│  │ ██████████████████████░  87% ⚠️ │    │  ← amber, approaching
│  └─────────────────────────────────┘    │
│  ┌─────────────────────────────────┐    │
│  │ [✈️]  Travel                    │    │
│  │       $320 / $200               │    │
│  │ ████████████████████████  160%🔴│    │  ← rose, over budget
│  └─────────────────────────────────┘    │
│                                         │
│  No budget set ─────────────────────    │
│  [🎮] Entertainment  $45     [ Set ]    │
│  [🏠] Home           $0      [ Set ]    │
└─────────────────────────────────────────┘
```

- Progress bar color: teal (<70%), amber (70–90%), rose (>90%)
- Over-budget bars fill to 100% width and pulse red subtly
- Categories without budgets shown at bottom with a "Set" shortcut button
- Tapping a budget card drills into that category's transaction list

### 5. Transaction Detail / Category Bottom Sheet

Triggered by tapping any transaction row.

```
─── drag handle ───────────────────────────────────────

  [🍽]  Panda Express
  Jun 21, 2026 · Chase Sapphire · $35.50

  ─────────────────────────────────────────────────────

  Category
  ┌──────┐ ┌──────┐ ┌──────┐ ┌──────┐
  │  🍽  │ │  🚗  │ │  ✈️  │ │  🎮  │
  │ Food │ │Trans │ │Travel│ │Entmt │
  └──────┘ └──────┘ └──────┘ └──────┘  → scrollable row

  Subcategory  (shown after category selected)
  [ Restaurants ] [ Groceries ] [● Lunch ] [ Coffee ]

  ─────────────────────────────────────────────────────

  Apply to all future Panda Express?    ●──── (toggle, on)

  Mark as Reimbursement                 ○──── (toggle)

  ─────────────────────────────────────────────────────

         [ Save Changes ]
```

### 6. Reimbursement Sheet

Triggered when "Mark as Reimbursement" toggle is on, or tapping "Add reimbursement" on an expense.

```
─── drag handle ───────────────────────────────────────

  Reimbursement for
  Panda Express  -$100.00

  ─────────────────────────────────────────────────────

  Link incoming payment(s)

  [↩️] Zelle from Alice    +$30.00   Jun 19   [ Link ]
  [↩️] Zelle from Bob      +$30.00   Jun 20   [ Link ]  ← suggested: recent transfers in
  [↩️] Venmo               +$15.00   Jun 21   [ Link ]

  Linked:
  ✓ Zelle from Alice   $30.00    [×]
  ✓ Zelle from Bob     $30.00    [×]

  ─────────────────────────────────────────────────────

  Net expense:   $100.00 − $60.00 = $40.00
                                    ↑ rose

         [ Save Reimbursement ]
```

### 7. Add / Edit Manual Transaction Sheet

Triggered by FAB `+` on the Transactions screen, or tapping a manual transaction row.

```
─── drag handle ───────────────────────────────────────

  Add Transaction

  ┌─────────────────────────────────────────────────┐
  │  [ Expense ]        [ Income ]                  │  ← segmented toggle
  └─────────────────────────────────────────────────┘

  Amount
  ┌─────────────────────────────────────────────────┐
  │  $  ___________                                 │  ← large numeric input
  └─────────────────────────────────────────────────┘    display font, xl

  Category
  ┌──────┐ ┌──────┐ ┌──────┐ ┌──────┐
  │  🍽  │ │  🚗  │ │  ✈️  │ │  🎮  │  → scrollable row
  │ Food │ │Trans │ │Travel│ │Entmt │
  └──────┘ └──────┘ └──────┘ └──────┘

  Subcategory  (shown after category selected)
  [ Restaurants ] [ Groceries ] [● Lunch ] [ Coffee ]

  Date                              Jun 21, 2026 ›
  Note (optional)
  ┌─────────────────────────────────────────────────┐
  │  e.g. Street food, cash                         │
  └─────────────────────────────────────────────────┘

  ─────────────────────────────────────────────────

  [ Save Transaction ]
```

- Amount input: large, display font, centers in the field — primary focus on open
- Expense type: amount shown in `expense` color. Income type: `income` color
- Date field taps to inline date picker (iOS DateTimePicker)
- Edit mode: shows "Delete Transaction" link at bottom in `expense` color, with confirmation prompt
- No account logo on manual rows since there's no linked account

### 8. Settings → Plaid Developer Account (BYOK)

New screen. Reached from Settings, and auto-routed to from any "Link your bank" entry point if the user has no saved credentials yet.

```
┌─────────────────────────────────────────┐
│  ‹ Settings                              │
│                                         │
│  Plaid Developer Account                │
│  ToFi uses your own free Plaid         │  ← sans, textSecondary, sm
│  developer account so your linked       │
│  banks stay under your own usage.       │
│                                         │
│  ▾ How do I get these?                  │  ← expandable, textMuted → primary when open
│                                         │
│  Environment                            │
│  ┌────────────┐ ┌────────────┐          │
│  │  Sandbox   │ │ Production │          │  ← segmented toggle
│  └────────────┘ └────────────┘          │
│                                         │
│  Client ID                              │
│  ┌─────────────────────────────────┐    │
│  │ 5f2a9c...                        │    │  ← mono font, plain text (not sensitive)
│  └─────────────────────────────────┘    │
│                                         │
│  Secret                                 │
│  ┌─────────────────────────────────┐    │
│  │ ••••••••••••••••••••••    [ 👁 ] │    │  ← SecretInput component
│  └─────────────────────────────────┘    │
│                                         │
│  [        Test Connection        ]      │  ← secondary button, validates before save
│                                         │
│  [           Save            ]          │  ← primary teal button, disabled until valid
│                                         │
└─────────────────────────────────────────┘
```

- If credentials already exist: Client ID shown in full (harmless), Secret shown as a static masked placeholder with a "Replace" text link instead of an editable field — tapping "Replace" swaps in a fresh empty `SecretInput`
- "Test Connection" result surfaces inline: success in `income` green with a checkmark, failure in `expense` rose with the specific error (e.g. "Couldn't verify these keys — check for typos" or "This looks like a Sandbox secret but Production is selected")
- Save button stays disabled until a successful test has run against the currently-entered values
- This screen never triggers Plaid Link itself — it only manages credentials; Link is launched separately from the Accounts screen once credentials are saved

---

## Motion & Animation

- **Category card ring**: drawn with `react-native-svg` arc, animated with `react-native-reanimated` on mount (ring fills from 0 to budget% over 600ms, easeOut)
- **Bottom sheets**: slide up with spring animation (damping 20, stiffness 180)
- **Amount changes**: number transitions use a brief fade (150ms) rather than counter animation — keep it subtle
- **Calendar day select**: selected cell scales to 0.95 then back (spring, 200ms)
- **Budget bar fill**: animates on screen mount, 500ms easeOut
- **Secret reveal/re-mask**: instant, no animation — avoid drawing extra attention to a sensitive field toggling
- Respect `prefers-reduced-motion` / accessibility settings — all animations should degrade to instant state change

---

## Icon System

Use `@expo/vector-icons` (Ionicons set) for UI icons. Category icons are emoji-based (stored as a string in the DB, rendered via `<Text>`).

UI icons (Ionicons):
```
chevron-back / chevron-forward   month navigation
eye / eye-off                    privacy toggle, secret reveal toggle
add-circle                       add account
calendar / list                  view mode toggle
settings                         settings tab
card                             accounts tab
receipt                          transactions tab
wallet                           dashboard tab
key                              Plaid Developer Account settings entry
```

---

## Empty & Loading States

- **Loading**: skeleton placeholders matching the exact shape of the real content (card grid skeletons, row skeletons) — not a spinner
- **No transactions**: "No transactions this month" with a small receipt illustration, muted
- **No budget set**: category card shows a dashed ring and "Set budget" label instead of a solid ring
- **No accounts linked**: full-screen prompt to connect via Plaid Link with the teal CTA button — if no Plaid credentials exist yet, this prompt reads "Connect your Plaid developer account to get started" and routes to the BYOK screen instead
- **Error**: inline error banner at top of screen, rose background, dismiss button — not a modal

---

## Accessibility

- All interactive elements: minimum 44×44pt touch target
- Color is never the only indicator — budget health also shown via icon (✓ ⚠️ 🔴) and text percentage
- All amounts have `accessibilityLabel` with unmasked value even when privacy mode is on (screen reader only)
- Bottom sheets trap focus when open
- The Secret input's reveal toggle has an explicit `accessibilityLabel` ("Show secret" / "Hide secret") since the icon alone isn't sufficient
