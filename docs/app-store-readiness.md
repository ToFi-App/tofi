# App Store Readiness — ToFi (first submission)

Assessed against the App Review Guidelines from the current state of `frontend/` and `backend/`.
Status legend: **BLOCKER** = near-certain rejection, **REQUIRED** = must exist before submit,
**FIX** = will likely draw a rejection or a metadata rejection, **DO** = ordinary submission work.

## Decisions taken

- **App name is ToFi.** Renamed from Ledge in `app.json`, the login wordmark, onboarding copy, and
  the Plaid Link `client_name`. Verified free on the US App Store as of 2026-08-11 (nearest
  neighbours are *Tofi Cat Animated Stickers* and *TOFY Dating* — neither is Finance).
- **Bundle ID stays `com.qihongw08.ledge`.** Users never see it, and changing it would require a
  new App Store Connect app record (the API cannot create one), a new Google OAuth iOS client
  (`iosUrlScheme` is bound to the bundle ID), new EAS credentials, and new Supabase redirects.
- **The BYO-Plaid onboarding ships as-is** (§1.1) — a deliberate call to submit and handle the
  likely rejection in Resolution Center. Reply drafted in §7.

---

## 1. Blockers (product changes, not metadata)

### 1.1 BLOCKER — Onboarding requires the user's own Plaid developer account

`frontend/app/onboarding/plaid-setup.tsx` → `components/plaid/PlaidCredentialsForm.tsx` makes
step 1 of onboarding "create a free account at dashboard.plaid.com, then paste your Client ID
and Secret." Nothing in the app works until that is done (`useOnboardingGate`,
`needs-credentials`).

Why this gets rejected:

- **2.1 App Completeness** — the reviewer cannot get past the first screen without signing up
  for a third-party developer platform and waiting on Plaid Production/Trial approval. Review
  notes cannot paper over this; a demo account with credentials pre-saved might get through, but
  it is not the shipping experience and reviewers often re-test with a fresh account.
- **4.2 Minimum Functionality** — an app whose setup is "bring your own API keys" reads as a
  developer utility, not a consumer app.
- Asking an end user to paste a long-lived API secret into a form is also the kind of thing that
  draws 5.1.1 scrutiny.

Resolution options, in order of how well they land with review:

1. **Ship your own Plaid production account** (the normal architecture). App holds one set of
   server-side Plaid credentials; users just tap "Connect a bank." Requires Plaid Production
   access and pricing on your side. This is what Apple expects a consumer finance app to look
   like.
2. **Keep BYO-Plaid but make it optional and post-onboarding.** The app must be fully usable
   without it — manual accounts and manual transactions only — with bank linking presented as an
   advanced/optional feature. This is defensible under 4.2 only if the manual experience is a
   real product on its own.
3. Ship BYO-Plaid as-is and expect a 2.1/4.2 rejection.

Option 1 is the only one I'd submit without expecting a round trip.

**Decision: submitting as-is (option 3).** The Resolution Center reply is drafted in §7. To give it
the best chance, the demo account handed to review must already have Plaid credentials saved and at
least one institution linked, so the reviewer lands past `needs-credentials` on first sign-in.

### 1.2 ~~BLOCKER~~ DONE — In-app account deletion

**Guideline 5.1.1(v)** requires any app with account creation to offer in-app deletion of the
account *and* its data. Shipped at **Settings → Delete Account**.

Backend:

- `routers/account.ts` — `account.delete`, a protected mutation taking no input. The account is
  always the caller's, read from the verified JWT; accepting a user id would let one user ask
  for another's.
- `services/accountDeletionService.ts` — revokes Plaid, deletes rows, deletes the auth user, in
  that order. Plaid first because revocation needs the access tokens the row delete destroys.
  The auth user last because it is the only irreversible, unretryable step — while it exists the
  user can sign in and try again, so any earlier failure leaves a recoverable state rather than
  an orphaned login. Plaid failures are swallowed: a revoked token or an unreachable Plaid must
  not block a deletion the user is entitled to.
- `repositories/accountDeletionRepository.ts` — deletes all eleven user-scoped tables in one
  transaction, in FK-dependency order. **None of the `user_id` foreign keys cascade**, so the
  ordering is load-bearing: anything referencing `categories`/`subcategories` must go first or
  Postgres rejects the delete.
- `plaidItemRepository.listAllDecryptedTokens` — new, and unlike `listDecryptedTokens` it keeps
  *disconnected* items. A soft-disconnected Item is still live at Plaid, so skipping it would
  leave a valid token for data the user asked us to erase.

Frontend:

- `components/settings/DeleteAccountSheet.tsx` — confirmation sheet itemising what is removed,
  with a destructive confirm. Also states what is *not* touched: the user's own Plaid developer
  account and their actual bank accounts.
- `hooks/useDeleteAccount.ts` — calls the mutation, then `clearLocalSession()`.
- `lib/supabase/auth.ts` — new `clearLocalSession()` using `signOut({ scope: 'local' })`. A
  normal `signOut()` calls the auth server, which can error for the now-deleted user and leave a
  local session pointing at a deleted account. The local variant still emits SIGNED_OUT, so the
  existing `useResetCacheOnUserChange` listener clears the React Query and MMKV caches — no
  deleted user's data survives on the device.

Covered by 12 new backend tests (ordering, Plaid-failure tolerance, no-Plaid accounts, auth-user
failure surfacing, and that revocation precedes the row delete).

> `getServiceClient()` was dead code until this shipped. `SUPABASE_SERVICE_ROLE_KEY` is
> confirmed set in the Vercel production environment, so the admin delete has what it needs.

### 1.3 ~~BLOCKER~~ DONE — Sign in with Apple

**Guideline 4.8** requires an equivalent privacy-preserving login alongside any third-party
login service. Shipped on `main` (PR #39) and merged into this branch.

- `lib/supabase/auth.ts` — `signInWithApple()` via `expo-apple-authentication`, mirroring the
  Google path: native sheet mints an identity token, Supabase's Apple provider verifies it.
  Cancels return null rather than surfacing an error.
- `components/auth/AppleSignInButton.tsx`, rendered **above** Google in `login.tsx` — 4.8 wants
  Sign in with Apple at least as prominent, and review reads order as prominence.
- `app.json` — `expo-apple-authentication` plugin; introspection confirms the
  `com.apple.developer.applesignin` entitlement is applied.

> **Prerequisites outside the repo, both unverified from here.** The Apple Developer portal App
> ID needs the Sign in with Apple capability enabled, and Supabase's Apple provider needs to be
> configured with the bundle ID as its client ID. Sign-in fails at runtime without either.
> Requires a new native build — the entitlement cannot go out OTA.

---

## 2. Required before submit

### 2.1 ~~REQUIRED~~ DONE — Privacy Policy, live and public

Live at <https://ledge-oauth-88792.netlify.app/privacy.html> and entered in App Store Connect.
Source: `oauth-redirect/privacy.html`.

It describes:

- Data collected: Google account email/name, bank account + transaction + holdings data pulled
  via Plaid, user-created categories/budgets/notes, the user's Plaid API credentials (encrypted
  — `backend/src/lib/crypto`).
- Processors: Supabase (auth + database), Plaid (bank data aggregation), Vercel (API hosting),
  Google (sign-in), Expo/EAS (builds and OTA updates), Logo.dev (holding logos, fetched by
  ticker symbol straight from the device).
- That data is linked to the user's account identity.
- That data is **not** sold, rented, traded, or used for advertising or tracking (true today —
  there are no ad or attribution SDKs in `package.json`).
- Account deletion: how to do it in-app and what gets deleted.

### 2.2 ~~REQUIRED~~ DONE — Support URL

Live at <https://ledge-oauth-88792.netlify.app/support.html> and entered in App Store Connect as
both the support and marketing URL. Source: `oauth-redirect/support.html`. Contact address is
tofi.wallet@gmail.com. Covers Plaid setup, linking, categorization, transfers, reimbursements,
disconnecting an institution, and account deletion.

Terms of service also shipped at `/terms.html` (§2.3).

Standing note: these sit on the netlify autogenerated subdomain. Functionally fine and Apple
accepts it, but a custom domain would read better than `ledge-oauth-88792.netlify.app` on a
finance app's privacy policy — worth doing before launch, and it is a pure DNS change plus two
field updates.

### 2.3 PARTLY DONE — Terms of Service / in-app legal links

Terms are live at <https://ledge-oauth-88792.netlify.app/terms.html>
(`oauth-redirect/terms.html`), covering the not-a-financial-advisor disclaimer, the user's
responsibility for their own Plaid developer account, acceptable use, and liability.

Still outstanding: a **Legal** section in Settings linking to the privacy policy and terms. Not
an Apple requirement for this app type, but a finance app with no in-app route to either reads
badly. Ships fine as an OTA update — no native change.

**Both web pages currently say account deletion is by email**, which is accurate today. Both have
a `TODO` comment marking the paragraph to rewrite as "Settings → Delete Account" the moment §1.2
ships. Apple requires in-app deletion, so that paragraph must be true before submission.

---

## 3. Fixes

### 3.1 ~~FIX~~ DONE — Stale/boilerplate Face ID permission string

`ios/Ledge/Info.plist:54` carried `expo-secure-store`'s default string:

```
NSFaceIDUsageDescription = "Allow $(PRODUCT_NAME) to access your Face ID biometric data."
```

Nothing in the app uses biometrics — there are no `LocalAuthentication` or `requireAuthentication`
call sites. Fixed by passing `faceIDPermission: false` to the plugin in `app.json`, which makes
`createPermissionsPlugin` drop the key rather than write the default.

Verified with `npx expo config --type introspect`: `NSFaceIDUsageDescription` is absent from the
resolved `ios.infoPlist`, and `CFBundleDisplayName` is `ToFi`.

`ios/` is gitignored and prebuild-generated, so the checked-out `ios/Ledge/` tree is now stale —
the next `prebuild` produces `ios/ToFi/`. Requires a new native build; this cannot go out OTA.

### 3.2 FIX — Sandbox environment toggle in production UI

`PlaidCredentialsForm` renders a Sandbox/Production segmented control. It's gated server-side by
dev email (`plaidCredentialService.allowedEnvironments`), so a reviewer won't see it — good. Keep
it that way; if the gate ever opens, "Sandbox" in production UI is a 2.2 (beta software) flag.

### 3.3 FIX — Production copy scan

Clean otherwise. The only hits from the beta/test wording scan are legitimate input placeholders
and test files. The one production string worth a look is `PlaidCredentialsForm.tsx:162` ("request
the free Trial plan or Production access") — it goes away with §1.1 option 1.

---

## 4. App Store Connect fields

App record: **`6797382662`**, bundle `com.qihongw08.ledge`, state `PREPARE_FOR_SUBMISSION`, never
submitted. It was named **`Ledge - Beta`** — "Beta" in an App Store name is a 2.2 rejection by
itself, now fixed.

Set via the API on 2026-08-11 (key `V546DCVRNG`):

| Field | Value | Status |
|---|---|---|
| Name | `ToFi` | done — Apple validated uniqueness on write, so the name is held |
| Subtitle | `Every account, one number.` (26/30) | done |
| Primary category | Finance | done |
| Description | 1543/4000 chars, see §4.1 | done |
| Promotional text | 133/170 | done |
| Keywords | 85/100 | done |
| Version string | `1.0` → `1.0.0` to match `app.json` | done |
| IDFA | declared not used | done |
| Age rating | questionnaire already complete, resolves to 4+ | already done |
| Export compliance | `ITSAppUsesNonExemptEncryption: false` in `app.json` so every build carries it | done |
| Privacy Policy URL | `/privacy.html` on the netlify site | done |
| Support URL | `/support.html`, also set as marketing URL | done |
| Copyright | — | **blocked: needs the legal rights-holder name** |
| Review notes + demo account | §4.2 | **blocked on a provisioned demo account** |
| Screenshots | — | **not started** |
| Privacy labels | §4.3 | **not started** |

Export compliance is defensible: the iOS binary uses only HTTPS/TLS and the Keychain. The
AES-256-GCM in `backend/src/lib/crypto/aes.ts` is Node's standard `crypto`, runs server-side, and
is not part of the shipped binary.

### 4.1 Field values as written

The exact copy now live in the record:

- **Subtitle:** `Every account, one number.`
- **Keywords:** `budget,net worth,spending,expense tracker,money manager,finance,accounts,transactions`
- **Promotional text:** "Connect your banks, cards, and brokerages and see one number that means something. Spending, budgets, and net worth in a single view."
- **Description:** opens on "Every account you have, in one number.", then sections for net worth,
  spending/categorization, budgets, reimbursements, investments, and privacy. It closes with an
  explicit SETUP paragraph stating that ToFi runs bank connections under the user's own free Plaid
  developer account. That paragraph is deliberate: given §1.1 is shipping as-is, burying the setup
  requirement would add a 2.3.1 (accurate metadata) problem on top of the 2.1/4.2 risk.

Regenerate or edit any of these with `scripts/asc.mjs` — a dependency-free App Store Connect API
client. It reads the issuer UUID from `.asc.env` (gitignored) and the `.p8` from
`~/Downloads/AuthKey_<keyid>.p8`, and never prints either. The record's IDs are exported as `TOFI`.

```bash
node scripts/asc.mjs '/v1/apps?fields[apps]=name,bundleId'
```

Note that `.asc.env` and the `.p8` in `~/Downloads` are local-only. CI still uses the repo secrets
(`ASC_API_KEY_*`) via `.github/workflows/frontend-eas.yml`, which is unaffected by any of this.

### 4.3 Privacy labels (map from actual behavior)

- **Contact Info → Email Address** — collected, linked to identity, App Functionality.
- **Financial Info** — collected (bank balances, transactions, holdings via Plaid), linked to
  identity, App Functionality. This is the one Apple looks hardest at for finance apps.
- **Identifiers → User ID** — collected, linked, App Functionality.
- **User Content** — category names, budgets, notes on transactions. Linked, App Functionality.
- **Tracking: No.** No ad/attribution SDKs present.
- **Diagnostics** — only if you add crash reporting before submit; you have none today.

### 4.2 Review notes template

```text
ToFi is a personal finance app that aggregates a user's own bank, credit card, and brokerage
accounts into one net-worth view.

Demo account: <email> / <how to sign in>
This account already has bank data linked, so the reviewer lands directly on the dashboard and
does not need to complete any account-linking setup.

Sign in: tap "Sign in with Apple" on the launch screen (Google is also available).
Account deletion: Settings > Delete Account. Self-service, no email required.
Privacy policy: https://ledge-oauth-88792.netlify.app/privacy.html
Support: https://ledge-oauth-88792.netlify.app/support.html

ToFi has no user-generated public content, no messaging, and no user-to-user interaction, so
there are no reporting or blocking surfaces.
```

Sign in with Apple is the path to point reviewers at — Google Sign-In can be awkward inside the
review environment.

---

## 5. Build / release mechanics

- `app.json` version is `1.0.0`; `eas.json` uses `appVersionSource: remote` with
  `autoIncrement` on the production profile — build numbers are handled.
- Bundle ID `com.qihongw08.ledge` — kept deliberately (see Decisions). It no longer matches the
  app name, which is fine and invisible to users, but it **cannot be changed after publish**, so
  this is the last moment to reconsider.
- `expo-updates` is configured. Remember: OTA updates cannot remove native permission strings,
  add entitlements, or change the bundle ID — §1.3 and §3.1 both need a new binary.
- Confirm `EXPO_PUBLIC_API_URL`, Supabase URL/anon key, and Google client IDs are set to
  production values in the EAS `production` environment.
- Verify Supabase RLS is on for every user-scoped table before a public launch.

Pre-submit verification:

```bash
cd frontend && npx tsc --noEmit && npx vitest run
```

```bash
cd backend && npx tsc --noEmit && npx vitest run
```

---

## 6. Rename record (done)

Display name only; no bundle ID, slug, or URL scheme change, so nothing in the OAuth or EAS
wiring moves.

| File | Change |
|---|---|
| `frontend/app.json` | `expo.name` → `ToFi` |
| `frontend/app/(auth)/login.tsx` | login wordmark → `ToFi.` |
| `frontend/app/onboarding/link-account.tsx` | "ToFi never sees them" |
| `frontend/components/plaid/PlaidCredentialsForm.tsx` | "ToFi uses your own free Plaid…" |
| `backend/src/services/plaidLinkService.ts` | Plaid Link `client_name` → `ToFi` (this is the name shown inside the Plaid Link sheet, so it must match) |
| `oauth-redirect/oauth-callback.html` | "Returning to ToFi…" in the title and body — the interstitial a user sees mid-OAuth. The `ledge://oauth-callback` deep link is unchanged, since the URL scheme stays. |

Left alone on purpose: `slug` (`ledge`, the EAS project identifier), `scheme` (`ledge://`, wired
into OAuth redirects), the Android package, and internal identifiers like
`categoryIdsByLedgeName`. Docs under `docs/superpowers/` are historical plans and were not
rewritten.

Verified: `tsc --noEmit` clean and all tests pass in both packages (185 backend, 421 frontend).

Still to do for the rename: the app icon and any wordmark inside `frontend/assets/` still say
Ledge if they contain the name — check `icon.png` and the splash before building.

---

## 7. Resolution Center reply — expected Plaid rejection

Because §1.1 is shipping as-is, expect a 2.1 or 4.2 rejection on first submission. Draft reply:

```text
Hello App Review team,

Thank you for the feedback.

Issue:
Review was unable to complete setup because the app's first-run flow asks for Plaid API
credentials.

Resolution / clarification:
ToFi aggregates a user's own financial accounts through Plaid, and it is architected so that
each user's bank connections run under their own Plaid account rather than a shared one. This
means the data for a user's linked banks is never pooled with other users' data on our side.

For review, this setup step is already complete. The demo account below is fully provisioned
with saved credentials and linked account data, so signing in lands directly on the dashboard
with no setup required:

  Email: <demo email>
  Sign-in: tap "Sign in with Apple" or "Continue with Google" on the launch screen

Testing:
After sign-in, the Dashboard, Transactions, Budgets, and Accounts tabs are all populated and
fully functional with the demo data.

Privacy:
Privacy policy: <url>. ToFi does not sell, rent, or trade personal information, contains no
advertising or tracking SDKs, and requests no device permissions.

Please let us know if any additional clarification would help.
```

If Apple holds the line on 4.2, the fallback is §1.1 option 2: make bank linking optional and
ship manual account entry as the default experience. Worth having that scoped before submitting.

---

## 8. Final pre-submit checklist

- [x] App renamed to ToFi in the repo (§6) and in App Store Connect (§4)
- [x] `Ledge - Beta` name removed from the store record — was a 2.2 rejection on its own
- [x] Face ID permission string removed (§3.1)
- [x] Export compliance declared in `app.json` (§4)
- [x] Category, subtitle, description, keywords, promotional text set (§4)
- [x] Version string aligned at `1.0.0`, IDFA declared unused (§4)
- [x] Age rating questionnaire complete — resolves to 4+
- [x] Bundle ID decision final — staying `com.qihongw08.ledge`
- [x] Typecheck + tests pass on both packages
- [x] In-app account deletion shipped (§1.2) — still needs an end-to-end run on a real account
- [x] `SUPABASE_SERVICE_ROLE_KEY` confirmed set in Vercel production (§1.2)
- [x] Sign in with Apple added (§1.3)
- [ ] **Verify Apple capability on the App ID and the Supabase Apple provider** (§1.3)
- [x] Privacy policy live and entered in ASC (§2.1)
- [x] Support URL live and entered in ASC (§2.2)
- [x] Terms of service live (§2.3)
- [x] In-app Legal section linking to privacy, terms, and support (§2.3)
- [x] Deletion paragraphs on the web pages rewritten to point at Settings → Delete Account
- [ ] App icon / splash checked for the old Ledge wordmark (§6)
- [ ] Copyright set — needs the legal rights-holder name
- [ ] Privacy labels filled to match §4.3
- [ ] Review notes + demo account filled in, demo account pre-linked and verified on a fresh
      install (§1.1)
- [ ] Screenshots captured on required device sizes
- [ ] Accepted: Plaid onboarding ships as-is, §7 reply ready
- [ ] TestFlight smoke test: fresh install → sign in → onboarding → core flows → delete account →
      confirm data gone
