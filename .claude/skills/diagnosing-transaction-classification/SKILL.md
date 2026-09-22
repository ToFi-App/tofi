---
name: diagnosing-transaction-classification
description: Use when a transaction in the feed shows the wrong sign, badge, or category, is silently missing from spend/income totals, when a day header's IN/OUT disagrees with the rows under it, or when a transfer was auto-paired with something unrelated.
---

# Diagnosing Transaction Classification

## Overview

Every classification decision — sign, badge, what counts toward totals, transfer
pairing — happens **client-side** in `TransactionFeedProvider`, over the MMKV cache.
The backend only relays rows. A backend log or a Plaid API call cannot explain a
wrong-looking row; the answer is in the feed pipeline on the device.

**Never query Plaid or the dev database to investigate this.** The device already holds
every row involved.

**Any diagnostic you build here is throwaway.** It prints real financial data to a
console, so it must never be committed — that is why this skill describes it instead of
shipping it. Restore the repo before you finish (see the checklist at the end).

## Start here: synthetic repro, no device

This is the default path and it needs no simulator. Build `FeedItem`s matching the shape
you suspect, run them through `applySweepExclusion`, and assert on `countsTowardTotals` /
`isInternalMovement` / `isInvestmentSweep` / `dayTotals`.

Copy the `item()` helper from `lib/transactions/sweepExclusion.test.ts` — it defaults
every `FeedItem` field. Put your scratch file inside `frontend/` (vitest must resolve the
`@/` alias), run it with `npx vitest run <path>`, and `console.log` whatever you need.
**This is how you run a dump without a device** — you do not need Metro or the simulator
to see the pipeline's verdicts.

A synthetic repro that reproduces the report *is* the diagnosis. A device run only
confirms which PFC code the institution actually sent.

Real amounts and dates are fine in a scratch file you delete. **Never let real merchants,
amounts, or dates reach a committed test** — neutral fixtures there.

## What decides exclusion

```
mergeFeed → applyTransfers → applySweepExclusion → countsTowardTotals
```

`countsTowardTotals` is `!pending && !isReimbursementIncome && !isInternalMovement && !isSweptOutflow`.
`isInternalMovement` covers two distinct causes, so the useful breakdown is five:

| Reason | Condition | Lives in |
|---|---|---|
| `pending` | not settled yet | `totals.ts` |
| `reimbursement-income` | already netted against its expense | `applyTransfers` |
| `transfer-record` | `transferKind !== null` | `applyTransfers` |
| `internal-movement-pfc` | brokerage cash account **and** `pfcDetailed ∈ INTERNAL_MOVEMENT_PFC` | `totals.ts` |
| `swept-outflow` | see both gates below | `sweepExclusion.ts` |

**`swept-outflow` has two gates, and the PFC one is easy to miss.** The row must be a
brokerage-cash outflow whose `pfcDetailed` is in **`SWEEP_OUTFLOW_PFC`** (a *different*
set from `INTERNAL_MOVEMENT_PFC`, in a different file, with overlapping members), **and**
mirror an equal same-account inflow within 1 day. An identical pair differing only in the
outflow's PFC will classify differently — check the code before concluding anything.

Two flags that change the answer and are not exclusion reasons:

- **`hasCrossAccountCounterpart`** — an equal inflow on a *different* account within 7 days.
  Set instead of `isSweptOutflow`, so the row survives. Rule this out before blaming the sweep.
- **`isUnlinkedInternalTransfer`** — drives a second muted badge, **"Internal"**. A grey row
  with a muted pill is therefore ambiguous: read the predicate, not the badge.

`INTERNAL_MOVEMENT_PFC` and `SWEEP_OUTFLOW_PFC` are **not exported**, and no exported
function separates `transfer-record` from `internal-movement-pfc`. To print a single
reason you must duplicate those sets into your scratch module — acceptable only because
it is deleted. Re-read them from source each time; do not trust a copy in this file.

## The dump worth building

One function taking the feed **after `applyTransfers` and before `applySweepExclusion`**
— the same handoff the provider makes — plus accounts and a `{from, to}` range. It must
**call the real `applySweepExclusion`**; a reimplementation reports verdicts the app never
reached.

Per row print: date, displayed sign, merchant, source, `account.type/subtype`,
`pfcDetailed`, and the first matching reason (`COUNTS` if none). Group by date with
`dayTotals`, so output reads against a screenshot's day header.

**`displayed` is the inverse of the stored sign.** Stored convention is positive = money
out. Print `item.amount < 0 ? '+' : '-'` or you will misread every row.

**Name the inflow behind each `swept-outflow`.** Add a temporary out-param to
`applySweepExclusion` and push a record where it sets `isSweptOutflow`. This type does not
exist in the repo — define it in your scratch edit:

```ts
export interface SweepMatch {
  outflowId: string; inflowId: string; amount: number
  /** match.transferKind !== null — the tell that one inflow was spent twice. */
  inflowAlreadyPaired: boolean
}
```

## Running on the device

Only when you need to know the institution's real PFC code, and **only with the user's
explicit go-ahead** — launching the app syncs against their real linked accounts, which
is a materially bigger action than a synthetic test. Do not boot a simulator or launch
the app on your own initiative; if none is booted, say so and ask.

`frontend/package.json` has `dev:device` for physical devices over a tunnel. For the
simulator, drive it directly:

```bash
cd frontend && npx expo start --dev-client > "$SCRATCH/metro.log" 2>&1 &
until lsof -nP -iTCP:8081 -sTCP:LISTEN >/dev/null 2>&1; do sleep 1; done

# `booted` still lists every runtime, most with empty arrays — flatten, don't take the first key.
SIM=$(xcrun simctl list devices booted -j | python3 -c 'import json,sys; d=json.load(sys.stdin)["devices"]; u=[x["udid"] for v in d.values() for x in v]; print(u[0] if u else "")')
[ -n "$SIM" ] || { echo "No booted simulator — stop and ask the user"; exit 1; }

xcrun simctl terminate "$SIM" com.qihongw08.ledge
xcrun simctl openurl "$SIM" "ledge://expo-development-client/?url=http%3A%2F%2Flocalhost%3A8081"
```

Confirm the cache is populated before trusting an empty dump — `ledge-transaction-cache`
should be sizeable and recently modified:

```bash
ls -la "$(xcrun simctl get_app_container "$SIM" com.qihongw08.ledge data)/Documents/mmkv/"
```

### Gotchas that cost real time

| Symptom | Cause |
|---|---|
| App doesn't reload, no `iOS Bundled` line in the log | `simctl openurl` is a no-op on an already-running app. `terminate` first. |
| App shows an error screen on launch | The build has no embedded bundle. Metro must be listening *before* you launch. |
| Dump shows stale values | You read an earlier run. Search for the *last* block, not the first. |
| `screencapture -R` grabs the editor | It captures whatever is on top. `osascript -e 'tell application "Simulator" to activate'` first. |

## Before you finish

**The working tree is usually already dirty — "empty `git diff`" is the wrong target and
following it will destroy uncommitted work.** Capture the baseline *first*:

```bash
git status --porcelain > "$SCRATCH/baseline.txt"
md5 frontend/lib/transactions/sweepExclusion.ts frontend/components/transactions/TransactionFeedProvider.tsx > "$SCRATCH/baseline-md5.txt"
```

- [ ] Scratch modules and scratch tests deleted
- [ ] Every production file you touched restored — `md5` matches the baseline byte-for-byte
- [ ] `git status --porcelain` identical to `baseline.txt`
- [ ] Metro stopped, no simulator left booted that you booted
- [ ] `cd frontend && npx tsc --noEmit && npx vitest run` — **the `cd` is required.** From the
      repo root `tsc` prints its help text and exits 0 (a fake pass), and vitest picks up the
      backend suite and reports failures that do not exist.

## Common mistakes

- **Reading a badge as the cause.** `Investment` and `Internal` are conclusions. The
  predicate is the why.
- **Trusting a single day.** Widen the range: one bug was only explicable once an adjacent
  day showed two inflows summing to one payment.
- **Assuming amount matching is safe.** Several rules key on exact amount within a window.
  Coincidences are the usual root cause.
- **Expecting a stray inflow to signal the problem.** Both legs of a funded payment can
  vanish by *different* rules — the outflow as `swept-outflow`, its funding inflow as
  `internal-movement-pfc`. The month is just quietly light, with nothing pointing at it.
