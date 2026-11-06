# ToFi

[Download on the App Store](https://apps.apple.com/us/app/tofi/id6797382662)

A personal budgeting app for iOS that connects to bank, credit card, and investment accounts via Plaid. Users categorize transactions, set budgets, and track reimbursements — built for a small, closed group of friends rather than the general public.

Each user connects Plaid with their **own** Plaid developer credentials (BYOK — bring your own key), entered in-app after signup. This keeps everyone's linked-account usage isolated under their own free Plaid account instead of sharing one app-wide key.

Raw financial data (transactions, balances, account numbers) **never persists on the backend** — it's fetched live from Plaid on each request and relayed straight to the device. Only user-defined metadata (categories, budgets, vendor mappings, reimbursement links) is stored server-side.

The app was called Ledge before 2026-08. Source identifiers and docs now say ToFi, but four
externally-bound identifiers still say `ledge` and that is deliberate, not an oversight:

| Identifier | Bound to |
| --- | --- |
| `com.qihongw08.ledge` (bundle ID) | the shipped App Store Connect record — unchangeable, and Sign in with Apple user ids are scoped to it |
| `ledge` (Expo slug) | the EAS project |
| `ledge://` (URL scheme) | Plaid's redirect URI and `oauth-redirect/oauth-callback.html` |
| `ledge-*` (MMKV store ids) | data already on users' devices — the id is the on-disk filename |

See `docs/product.md`, `docs/architecture.md`, and `docs/design.md` for the full spec.

## Stack

|                 |                                         |
| --------------- | --------------------------------------- |
| Mobile          | React Native (Expo Router) + NativeWind |
| Backend         | Node.js + Fastify + tRPC + Drizzle ORM  |
| Database / Auth | Supabase (Postgres + Auth)              |
| Financial data  | Plaid API (BYOK, server-side only)      |

## Prerequisites

- Node.js and npm
- A [Supabase](https://supabase.com) project (Postgres + Auth), with the **Google** auth provider enabled and the **Email** provider disabled
- A [Google Cloud](https://console.cloud.google.com) project with an OAuth consent screen and two OAuth clients (one **Web**, registered on Supabase's Google provider; one **iOS**, for bundle ID `com.qihongw08.ledge`)
- Xcode + an Apple Developer account, for running the iOS app on a simulator or device
- Your own free [Plaid](https://dashboard.plaid.com/signup) developer account (added per-user, in-app — not a project-level secret)

## Backend

```bash
cd backend
cp .env.example .env   # fill in the values below
npm install
npm run db:migrate     # applies the Drizzle schema to your Supabase Postgres
npm run dev            # starts the Fastify server on :3000
```

`.env` values:

| Variable                      | Where to get it                                                          |
| ----------------------------- | ------------------------------------------------------------------------ |
| `DATABASE_URL`                | Supabase → Settings → Database → Connection string                       |
| `SUPABASE_URL`                | Supabase → Settings → API → Project URL                                  |
| `SUPABASE_ANON_KEY`           | Supabase → Settings → API Keys → Publishable key                         |
| `SUPABASE_SERVICE_ROLE_KEY`   | Supabase → Settings → API Keys → Secret key                              |
| `SUPABASE_JWT_SECRET`         | Supabase → Settings → API → JWT Secret                                   |
| `ACCESS_TOKEN_ENCRYPTION_KEY` | Generate: `openssl rand -hex 32`                                         |
| `PLAID_REDIRECT_URI`          | Only needed for Plaid OAuth institutions (Chase, BofA, etc.) — see below |
| `PORT`                        | Defaults to `3000`                                                       |
| `AXIOM_TOKEN`                 | Optional — Axiom → Settings → API tokens (ingest scope on one dataset)    |
| `AXIOM_DATASET`               | Optional — the Axiom dataset to ingest into (`tofi-backend`)               |

Both `AXIOM_*` variables are optional and must be set together; with either missing, nothing is
sent anywhere and logging is stdout only. That is the right setup locally — the sink exists
because Vercel's Hobby plan keeps runtime logs for about an hour, live-tail only, and gates Log
Drains behind Pro.

Every request ships one `info`/`warn` event describing method, path, status and duration, plus an
`error`/`warn` event per failed tRPC procedure. The send is handed to Vercel's `waitUntil`, so it
completes after the response without delaying it; off Vercel there is no such primitive and the
send is awaited instead. Query strings are never shipped — a batched tRPC GET carries its
procedure input there.

Run the test suite with `npm test`.

## Frontend

```bash
cd frontend
cp .env.example .env   # fill in the values below
npm install
npm run ios            # builds and launches on the iOS Simulator (or --device for a physical phone)
```

`.env` values:

| Variable                           | Where to get it                                                                                                                                                               |
| ---------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `EXPO_PUBLIC_SUPABASE_URL`         | Same Supabase Project URL as the backend                                                                                                                                      |
| `EXPO_PUBLIC_SUPABASE_ANON_KEY`    | Same Publishable key as the backend                                                                                                                                           |
| `EXPO_PUBLIC_API_URL`              | Your backend's URL — `http://localhost:3000` for the simulator; your Mac's LAN IP, or a tunnel (e.g. `cloudflared tunnel --url http://localhost:3000`), for a physical device |
| `EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID` | Google Cloud → Credentials → your **iOS** OAuth client ID                                                                                                                     |
| `EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID` | Google Cloud → Credentials → your **Web** OAuth client ID (the same one registered on Supabase's Google provider)                                                             |

Run the test suite with `npm test`.

### Notes on native builds

- **Google Sign-In is a native module** (`@react-native-google-signin/google-signin`). Its config plugin writes a URL scheme into the Info.plist, so replace `REPLACE_WITH_REVERSED_IOS_CLIENT_ID` in `app.json` with your iOS client ID's reversed form (Google Cloud lists it as the "iOS URL scheme"), then run `npx expo prebuild --clean && npm run ios` — it will not take effect on an existing build.
- **Plaid Link is a native module** (`react-native-plaid-link-sdk`) and does not run in Expo Go — `npm run ios`/`npm run android` build a real dev client via `expo prebuild`, which needs Xcode/CocoaPods installed.
- **Plaid OAuth institutions** (Chase, Bank of America, etc.) require a universal link, which needs: a paid Apple Developer Program membership, the **Associated Domains** capability with an explicit (non-wildcard) App ID registered on the Apple Developer portal, an `apple-app-site-association` file hosted at your redirect domain, that same URL registered in the Plaid Dashboard's Allowed redirect URIs, and `PLAID_REDIRECT_URI` set on the backend. Non-OAuth Sandbox institutions (e.g. "Platypus Bank", `user_good`/`pass_good`) work without any of this.
- **Real/live institutions require Plaid Production keys**, entered by each user in Settings → Plaid Developer Account with Environment set to Production. Sandbox keys only work against Plaid's fake test institutions — linking a real bank always needs the user's own Production `client_id`/`secret` from their Plaid dashboard.

## OAuth redirect site (`oauth-redirect/`)

Static pages served over HTTPS at the domain in `frontend/constants/links.ts`: the Plaid
universal-link `apple-app-site-association`, the `ledge://oauth-callback` interstitial, and the
privacy/support/terms pages linked from the App Store listing. Deployed to Netlify from a
developer's machine, not from CI.

`.netlify/` is gitignored — it is per-machine CLI state (an absolute publish path and the site id),
so each developer links once. The CLI is not a project dependency; run it through `npx`:

```bash
cd oauth-redirect
npx netlify-cli login   # once per machine
npx netlify-cli link    # once per clone — pick the existing site
npx netlify-cli deploy --prod
```
