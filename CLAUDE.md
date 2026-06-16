# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Advance HQ is the internal back-office for Advance Apparels — a Next.js 14 (App Router) app on top of Supabase. It pulls product/order/invoice/inventory data from **ApparelMagic** (external ERP, via REST + token auth) and adds workflows ApparelMagic doesn't have natively: a multi-carrier **shipping module** (UPS today, USPS via EasyPost in progress), pick-ticket queues, tickets/support, and reports.

**Dev port is 3003 and must stay 3003.** Sister Advance projects occupy 3001 and 3002 on the same dev machine — don't "fix" AHQ to those ports, and don't change the `-p 3003` flags in `package.json`. The Quick Links sidebar in `app/layout.tsx` also hardcodes `localhost:3001` (Team Inbox) and `localhost:3002` (Public Catalog) and assumes AHQ itself is elsewhere.

## Commands

```bash
npm run dev      # next dev on :3003
npm run build    # next build (TS strict; will fail on type errors)
npm run start    # next start on :3003
npm run lint     # next lint
```

No test runner is configured. Verification happens by hitting the dev server and the `/api/shipping/health` endpoint or the `/shipping/dev` smoke-test page (see README for the rate → label → void flow against UPS CIE sandbox).

Standalone deep-sync scripts live in `scripts/` and run outside Next. They read `.env.local` directly and talk straight to Supabase + ApparelMagic — useful when the in-app `/sync` admin routes are too slow or hit Vercel's `maxDuration`. Example:

```bash
node scripts/deep-sync-inventory.js
# env knobs: PAGE_SIZE, DRY_RUN=1, START_LAST_ID=..., SKIP_PRODUCT_SKUS=1
```

## Architecture

### Two Supabase clients — never mix them
- `lib/supabase.ts` exports `supabase` using the **anon key**. It exists mainly for legacy/browser code and `NEXT_PUBLIC_*` envs. Do not put it behind a wall that expects auth.
- `lib/supabase-admin.ts` exports `supabaseAdmin` using the **service role key**, which bypasses RLS. **Only import this in server code** (`app/api/**` route handlers, `lib/auth.ts`, `lib/carriers/**`). Importing it from a client component leaks the service role key.

### All client data access goes through `/api/data`
Client components must not call Supabase directly. They use `lib/db.ts`, a Supabase-like fluent builder (`db.from('orders').select('*').eq(...).order(...).limit(...)`) that POSTs a serialized query to `app/api/data/route.ts`. That route:

1. Validates the `ahq_session` cookie against the `app_sessions` table.
2. Whitelists the table against `ALLOWED_TABLES` and RPC against `ALLOWED_RPCS` (both defined inline at the top of `app/api/data/route.ts`). **Any new table that the UI needs to read/write must be added here** or queries will 403.
3. Re-builds the query against `supabaseAdmin` and returns the result.

Important `db.ts` invariant: query parameters must be nested under `body.query.*`. An earlier bug put them at the top level, which silently dropped filters/order/range because PostgREST returned the first 1000 rows unfiltered. If you change the wire shape, change both `lib/db.ts` and `app/api/data/route.ts` together, and don't trust small tables to surface the bug.

**`db.ts` mutation paths are unverified.** `lib/db.ts` exposes `db.from(t).update({...}).eq(...)`, `db.insert/update/delete`, and POSTs `{ action: 'mutate', ... }` — but the current `app/api/data/route.ts` only branches on `kind === 'rpc'` and table reads. There's no `action === 'mutate'` handler. Either a newer route version is missing from the repo or these client paths are dead. Today's UI writes (label creation, address updates, sync triggers) all go through dedicated `/api/shipping/*` and `/api/admin/*` endpoints, never `db.update()`. Before wiring a new client component to a `db`-level mutation, either confirm the route actually handles it or add a dedicated `/api/...` endpoint.

### Authentication
Custom session auth (not Supabase Auth). Flow: login route hashes the password (SHA-256 with random salt, in `lib/auth.ts`), creates a row in `app_sessions`, and sets the `ahq_session` httpOnly cookie. `middleware.ts` checks the cookie on every request except the `PUBLIC_PATHS` list — note that `/api/cron/`, `/api/admin/`, `/api/track/`, `/api/tickets/`, and `/api/auth/*` are intentionally bypassed. If you add a route that should be public, extend that list; if you add one that should be protected, do nothing.

### Carrier abstraction (`lib/carriers/`)
UI and API routes speak only the carrier-agnostic types in `lib/carriers/types.ts` (`Address`, `Box`, `RateRequest`, `LabelRequest`, etc.). Every carrier implements `CarrierClient` (`validateAddress`, `getRates`, `createLabel`, `voidLabel`, `track`). Routing:

- `carrierFor(key)` — direct lookup by `'ups' | 'easypost_usps'`.
- `resolveShipVia(shipVia)` — looks up the `shipping_service_map` table (DB-driven) to map a human ship-via string (e.g. `"UPS Ground"`) to `{ carrier, serviceCode, client }`. Adding a new shipping service is a DB row, not a code change.

UPS specifics (in `lib/carriers/ups/`):
- OAuth tokens are cached in the `ups_tokens` Supabase table (~4hr TTL). `getUpsToken()` is cheap to call repeatedly. Re-using across cold/warm starts is the whole reason the cache lives in the DB rather than memory.
- `UPS_ENV=production` switches base URL from `wwwcie.ups.com` (sandbox/CIE) to `onlinetools.ups.com`. CIE only validates NY/CA ship-to addresses — keep that in mind when testing.
- The Rating API uses `PackagingType` while Shipping uses `Packaging` for the same field — `boxToUpsPackage()` takes an `apiSurface` flag for this. Watch for it when touching mappers.
- COD funds codes: only `'0'` (cashier's check), `'8'` (any check), `'9'` (cash) are valid on UPS REST. `'1'` is rejected with a misleading "Missing COD funds code" error — don't add it back even if older UPS docs imply it works.
- Address Validation URL trailing segment is significant: `/api/addressvalidation/v2/1` returns validation only, `/v2/2` returns classification only, `/v2/3` returns both. We use **`/v2/3`** and must keep it. If it gets changed to `/v2/1`, `candidate.AddressClassification?.Code` becomes undefined, every address silently falls through as commercial, `ResidentialAddressIndicator` is never sent on the Rate/Ship calls, and residential deliveries undercharge by ~$5–6 (2026 surcharge) plus risk address-correction fees when UPS fixes the address in-transit.
- `isResidential` is plumbed end-to-end and every hop has to agree, or the residential surcharge gets silently dropped:
  1. UPS Address Validation response (`AddressClassification.Code`) → set in the carrier's `validateAddress`.
  2. `components/AddressValidationCard.tsx` local state — includes a manual override checkbox for cases UPS misclassifies (home offices, multi-tenant buildings).
  3. Parent page's `decidedAddress` via `onAddressDecided` — **all branches** (verified, corrected, force-ship, force-override) must carry `isResidential` forward.
  4. POST body to `/api/shipping/rates` and `/api/shipping/labels/create`.
  5. `boxToUpsPackage()` in `lib/carriers/ups/mappers.ts`, which writes `ResidentialAddressIndicator: addr.isResidential ? '' : undefined` (UPS expects an empty string to mean "yes", absence to mean "no" — don't "fix" that to `true`/`false`).
  If you refactor `onAddressDecided` or any of these hops, the failure mode is silent under-pricing, not a thrown error.

### ApparelMagic sync (`app/api/admin/sync-*` and `app/api/cron/sync-*`)
ApparelMagic is the upstream source of truth for products, customers, orders, invoices, payments, pick-tickets, shipments, and inventory. Sync routes:

- `/api/admin/sync-*` — manual triggers, called from the `/sync` page in the UI. Hold long-running upserts; set `export const maxDuration = 300` where needed.
- `/api/cron/sync-*` — Vercel cron entry points. They mostly re-export the admin route's POST handler so the logic stays in one place. `vercel.json` schedules `sync-pick-tickets-recent` every 5 minutes; other crons exist as routes but may or may not be wired up — check `vercel.json` before assuming.
- Cron paths are publicly accessible because `middleware.ts` whitelists `/api/cron/`. Don't put protected logic there directly; if you need auth, call into an admin route.
- The standalone `scripts/deep-sync-*.js` files are batched, lower-level versions of the same syncs — use them for initial backfills or to recover from a stalled sync without timing out the API route.

**Routes vs scripts is an architectural split, not a duplication.** Vercel Pro caps function execution at 5 minutes (`maxDuration = 300`); that cap is real and full-table backfills don't fit. So:
- **Routes** (`/api/admin/sync-*`, `/api/cron/sync-*`) handle **incremental** syncs on the 5-minute cron cadence — small per-tick deltas that finish well under the cap.
- **Scripts** (`scripts/deep-sync-*.js`) handle **full-table refreshes** — they run locally outside Next, batch-upsert per AM page, and have no execution-time ceiling.
Don't try to make a sync route do a full backfill; either page it across many cron ticks or run the deep-sync script.

Auth params to ApparelMagic are always `{ time: unix_seconds_now, token: APPARELMAGIC_TOKEN }`. Pagination uses `pagination[last_id]` keyset, not page numbers.

### Schema drift in sync mappers — silent failure mode
The `/api/admin/sync-*` routes wrap each row's upsert in a per-row `try/catch`, so when a mapper writes a column that doesn't exist on the target table, **every row fails and the error is swallowed**. The route returns 200, the UI says it synced, and the only evidence is in Vercel logs. Known offender: `/api/admin/sync-shipments` (the full sync) writes `ship_via` to a `shipments` table that has no such column. The frequent variant `/api/admin/sync-shipments-recent` has had `ship_via` removed and now surfaces the first per-row error into `sync_log.error_details` instead of swallowing it — see the recent-sync section below.

When touching any sync mapper, verify the columns actually exist first:

```sql
SELECT column_name FROM information_schema.columns WHERE table_name = '<table>';
```

For debugging a sync that "runs successfully but data doesn't update," run the matching `scripts/deep-sync-*.js` instead — those batch upserts per page, so a missing column surfaces as a loud per-page error rather than being hidden one row at a time. The deep-sync scripts are the source of truth when the API route is lying to you.

### Frequent "recent" sync (`/api/admin/sync-*-recent`)

In addition to the full `sync-*` routes, there are lightweight `sync-*-recent` variants for
`pick-tickets`, `orders`, `invoices`, `customers`, `products`, `purchase-orders`, and `shipments`. These are the ones wired to
run every ~5 minutes and finish in seconds; the full `sync-*` routes are the heavier backstop. The original
`sync-pick-tickets-recent` is the reference implementation — the others were modeled on it. The shared shape:

1. **High-water mark.** Find the highest AM id already in the table, seed AM's `pagination[last_id]` cursor
   one below it, and walk forward. Because AM ignores page-number pagination and `desc` ordering, walking
   forward from the high-water mark is the only way to fetch just-new records cheaply.
2. **Update-or-insert per row**, then refresh that row's children (order_items, invoice_items, etc.).
3. **Bail** on empty page, no cursor progress, `MAX_PAGES`, or the time budget — whichever hits first.
4. Stats (`scanned/created/updated/skipped/errors`, `bail_reason`, `start_cursor`, `end_cursor`,
   `first_error`) are returned in the response **and** persisted to `sync_log` (`first_error` lands in
   `error_details`), so you can diagnose from SQL without curling.

Steady state is `bail_reason: 'no-cursor-progress'` (or `'empty-page'`) with sub-second durations. A
`bail_reason: 'time-budget'` for a run or two is normal while a table is still catching up on a backlog.

**AM id columns are stored as TEXT — do not seed the cursor with `.order(col, desc).limit(1)`.** Postgres
sorts text lexicographically, so `"9999"` outranks `"10416"`; that seeds the cursor too low and makes the
sync re-scan hundreds of already-synced rows every tick (the original symptom: orders taking 57s and
re-`updated`-ing 400 rows each run). Worse, `DESC` puts NULLs first, so on a table with null ids (shipments,
see below) the query returns null and the route reads it as "empty table." The fix is the
`max_numeric_id(tbl, col)` Postgres function (in `supabase/migrations/` and run in the SQL editor) which
returns the true numeric max ignoring nulls. Each recent route calls it via
`supabase.rpc('max_numeric_id', { tbl, col })` with a `.order(...)` fallback if the function isn't installed.

```sql
-- one-time; safe to re-run
CREATE OR REPLACE FUNCTION max_numeric_id(tbl text, col text) RETURNS bigint
LANGUAGE plpgsql AS $$
DECLARE result bigint;
BEGIN
  EXECUTE format('SELECT COALESCE(MAX(NULLIF(regexp_replace(%I, ''\D'', , g), )::bigint), 0) FROM %I', col, tbl)
  INTO result; RETURN result;
END $$;
```

**The time-budget check must run inside the per-record loop, not just between pages.** `MAX_DURATION_MS` is
45s (margin under Vercel's 60s cap). Shipments does many child inserts (boxes/box_items/pallets) per row, so
a single page of 200 can blow 60s before the next page-level check — that caused a hard
`FUNCTION_INVOCATION_TIMEOUT` that never wrote to `sync_log`. Every recent route now checks the budget before
each record and breaks out of both loops cleanly.

**Duplicate-key (`23505`) is handled as an update, not an error.** The manual "Sync Now" button and the cron
can run the same window concurrently; both seed the same cursor, both insert, one loses the race. The routes
catch `23505` and fall back to an update (counted as `updated`), so a race doesn't show up as `errors`.

**Coverage limit:** high-water-mark-forward catches all *new* records and edits to the *newest* ones. Edits
to *older* records are not caught by the recent sync — the full `sync-*` route / `deep-sync-*.js` script is
the backstop for those. Acceptable because the things that change after creation (an open order getting
shipped) happen near the high-water mark anyway.

### Shipments has two id systems and no link between them
The `shipments` table mixes ApparelMagic shipments (keyed `am_shipment_id`, ~4.5k rows) with historical
**ShipStation** imports (keyed `shipstation_id`, no `am_shipment_id`, ~13.5k rows — and confusingly tagged
`source = 'apparel_magic'`). There is no shared key tying an AM shipment to its ShipStation counterpart.
`sync-shipments-recent` keys on `am_shipment_id`, so when it pulls AM shipments it cannot recognize that a
given shipment may already exist as a ShipStation row — it inserts a **second** row for the same physical
shipment. **Decision (2026-06): duplicates are acceptable** since we're migrating off ShipStation onto
HQ-native shipping and the ShipStation rows are a shrinking legacy. If that ever needs cleanup, dedupe on
tracking number.

**The shipments recent cron is currently PAUSED.** `vercel.json` schedules `pick-tickets`, `orders`,
`invoices`, `customers`, and `products` recent syncs (staggered by minute); `sync-shipments-recent` is **not**
scheduled. The route is installed and fixed (no `ship_via`, timeout-safe) — re-enabling is just adding its
cron entry back to `vercel.json`. When you do, expect a multi-day drip as it backfills AM shipment history;
for a fast backfill, use `scripts/deep-sync-shipments.js` (which still needs the `ship_via` removal applied).

### Purchase orders
Synced from AM into `purchase_orders` (header) + `purchase_order_items`, keyed on
`apparel_magic_id` (= AM `purchase_order_id`). Line items come **nested** in the AM
`purchase_orders` response (`purchase_order_items` array) — no per-PO sub-call. POs carry
`last_modified_time`, so the recent route does skip-if-unchanged.

- **Recent route + cron:** `/api/admin/sync-purchase-orders-recent` and its cron, on the
  exact pattern as the other recent routes (numeric high-water-mark via `max_numeric_id`,
  dup-key handled as update, mid-loop time budget, `first_error` -> `sync_log`). Scheduled in
  `vercel.json` at the minute-3 slot that shipments vacated.
- **No full `/api/admin/sync-purchase-orders` route.** Initial/bulk backfill is the deep-sync
  script `scripts/deep-sync-purchase-orders.js` (batched upserts per AM page, no Vercel
  timeout). The first backfill loaded 332 POs / 8,857 items in a single AM page, so the whole
  PO history is small — the recent cron is plenty for steady state.
- **Migration:** `supabase/migrations/20260616_purchase_orders.sql` — RLS on, no policies
  (service-role-only, like the rest). Header has a UNIQUE on `apparel_magic_id` (so the
  dup-key fallback and deep-script `upsert(onConflict)` work); items FK to the header `id` with
  `ON DELETE CASCADE` and also carry `apparel_magic_po_id` for the delete-by-parent refresh.
- **Whitelist:** `purchase_orders` and `purchase_order_items` are in `ALLOWED_TABLES`
  (`app/api/data/route.ts`) so the UI can read them.
- **UI:** `app/purchase-orders/page.tsx` is a list + detail drawer modeled on the Orders page;
  the nav entry lives in `app/layout.tsx` next to Payments. Deliberately *unlike* Orders: no
  Invoices/Pick-Tickets/Shipments relation tabs (those are sales-side; POs are inbound), and
  the vendor name is plain text because there's no vendor detail page to link to.
- **Deferred:** the `receivers` array on each PO (receipts/receiving against the PO) is not
  synced yet — that's where a future "Receipts" tab + a `purchase_order_receivers` table would
  go. No vendor page. No full admin sync route.

## Required environment (`.env.local`)
`.env.local.example` is **out of date** — it only lists Supabase and Anthropic. The full set actually used:

- Supabase: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`
- ApparelMagic: `APPARELMAGIC_TOKEN`, `NEXT_PUBLIC_APPARELMAGIC_URL` (defaults to `https://advanceapparels.app.apparelmagic.com/api/json`)
- UPS: `UPS_CLIENT_ID`, `UPS_CLIENT_SECRET`, `UPS_ACCOUNT_NUMBER`, `UPS_ENV` (`cie` or `production`)
- EasyPost (USPS): `EASYPOST_API_KEY`, `EASYPOST_TEST_API_KEY`, `EASYPOST_ENV`
- AI Assistant: `ANTHROPIC_API_KEY`

## Conventions
- TypeScript strict mode is on. `@/*` is aliased to the repo root.
- Tailwind for styling; no CSS modules. Brand color is `brand-600`.
- Don't commit `.backup-*` files — `.gitignore` covers them, and they're produced by install scripts. The repo currently has stale `.backup-*` artifacts at the root that should not be touched.
- Supabase migrations live in `supabase/migrations/` as plain SQL files dated `YYYYMMDD_*.sql`. They're applied by hand in the Supabase SQL editor — there's no migration runner here. Make them idempotent (use `if not exists`, `on conflict`, etc.) so re-running is safe.
