# B1 RLS — Step D status & handoff (2026-07-04, overnight run)

Branch `feat/must-fixes`. Everything below is **committed** and **behaviour-preserving with RLS still OFF**
(every change is a `withEntity()` wrap or a definer call with a legacy fallback). Nothing is enforced until the
team runs the migrations + flips the app to `cb_app`. **Done = the isolation suite GREEN under FORCE**, not `node --check`.

## What's complete

**The delivery-agent layer (SECURITY DEFINER, the audited crossing points):**
- `migration_b50_rls_delivery_functions.sql` — `chit_deliver`, `chit_participants`, `chit_log_all`, `chit_set_status_all`
- `migration_b51_rls_delivery_functions_extra.sql` — `chit_log_targets`, `chit_set_customer_priority_all`
- `migration_b52_rls_parity_read.sql` — `chit_participant_parity`
- Each derives the caller from `app.current_entity` (not a spoofable arg), validates sender-/participant-only
  before crossing, is owned by a BYPASSRLS role (so it crosses under FORCE), and `EXECUTE` is granted to `cb_app` only.

**The no-context guard** (`db/index.js`) — `rlsGuardCheck()` flags any of the 6 tenant tables hit via the
context-free `query()`; env `RLS_GUARD=off|warn|throw` (prod=off, dev/CI=warn, CI→throw). `RLS_TENANT_TABLES` exported.

**`routes/chits.js` — FULLY migrated** (the big one). Every tenant-6 access is now `withEntity(me)` (own rows) or a
definer (audited cross). Readers, all own-copy mutations, disputes, messages, status, void, priority-flag, and
`/send` (fan-out → `chit_deliver`). A cached `definersReady()` probe picks definer vs. legacy fallback, so it's
smoke-safe before/after the migration. `autoAssignReceived` binds to the **receiver**.
- **Behaviour refinement to note:** sender-**cancel** is now terminal on the whole chit (all participants + the
  sender's own copy), consistent with `/void`. Previously the sender's own copy was left unchanged. Revert easily if unwanted.

**Other route files — own-entity parts migrated:**
- `products.js` — all `catalogue_items` CRUD (own) → `withEntity(me)`.
- `attachments.js` — `isParticipant` `chit_status` check → `withEntity(me)`.
- `relationships.js` — `/customers`, `/customers/:id` (`customer_list`, owner-scoped) → `withEntity(me)`.
- `catalogue.js` — post-commit `customer_list` CRM add → `withEntity(shop)`.

## Per-table enablement status (coupling rule: enable only after ALL its routes are migrated)

| Table | Routes migrated? | Blocker to enabling |
|---|---|---|
| `chit_header` | chits.js ✅ · governance.js ✅ · catalogue.js order ✅ | **none — ready to enable** ✅ |
| `chit_status` | chits.js ✅ · attachments.js ✅ · actors.js ✅ · notifications.js ✅ · catalogue.js order ✅ | **none — ready to enable** ✅ |
| `chit_detail` | chits.js ✅ · catalogue.js order ✅ | **none — ready to enable** ✅ |
| `state_log` | chits.js ✅ · actors.js ✅ · connections.js ✅ · notifications.js ✅ · catalogue.js order ✅ | **none — ready to enable** ✅ |
| `catalogue_items` | products ✅ · browse reads ✅ (visibility policy) · **assist ❌** | assist help-KB writes — should route via a chit, not a direct write (see below) |
| `customer_list` | send ✅ · relationships ✅ · catalogue ✅ | **none — ready to enable** ✅ |

**Route migration is COMPLETE for 5 of the 6 tables** — `chit_header/status/detail`, `state_log`, `customer_list`
are fully covered and ready for the RED→GREEN proof. **`catalogue_items` is the only one waiting**, on the
`assist.js` rework (gap-capture should send a chit to the help desk, not write its catalogue directly).

`customer_list` is fully covered — it can be the first table enabled in the RED/GREEN proof.

## `catalogue_items` — DECIDED & IMPLEMENTED (Athi 2026-07-04): visibility-aware policy

A catalogue is a **showcase**, so `catalogue_items` stays RLS-protected but the READ policy is **visibility-aware**
(committed in `b49`):
- **writes** are strictly owner-only (`WITH CHECK entity_id = caller`) — **nobody can write another entity's
  catalogue**; the DB now enforces this, not just the app.
- **reads**: you always see your own; you see another entity's items only if its **catalogue-level visibility**
  (its active default schema's `visibility`) is `public`. `public | private` now; `network` (B2B connected-only)
  is a later OR-branch (slot noted in the policy). A public/no-context storefront reader (`withEntity(null)`) gets
  only public rows (via `NULLIF`).
- **item-level** hiding is a SEPARATE app-layer availability filter applied at **send** time (a row/column marked
  unavailable is never sent), NOT this policy.

Browse reads migrated: `relationships.js` supplier catalogue → `withEntity(me)`; `catalogue.js` public storefront +
order reprice → `withEntity(null)`; `my-orders` → `withEntity(me)`. So `catalogue_items` is fully covered **except
`assist.js`** (below).

## Route files status

- **`actors.js`** — ✅ DONE. Task assignment / break / assign / tasks are own-entity → `withEntity(me)` (the two
  `withTransaction` blocks + the sequential-`db()` handlers via a shadowed tx client; `identities` counts carve-out).
- **`notifications.js`** — ✅ DONE. The derived feed reads the caller's OWN `state_log` copy (cross-party events are
  fanned into it by the definers) → `withEntity(me)`. The old `OR action IN (...)` cross-branch is a no-op under RLS.
- **`governance.js`** — ✅ DONE. `countChitsToday` (dormant quota guard) → `withEntity(entity)` (own sent chits).
- **`connections.js`** — ✅ DONE. Request log + respond-receiver log are own-copy → `withEntity(me)`. The
  respond-**sender** `state_log` write (into the OTHER entity's copy) was **removed**: it violated the owner-only
  rule and was dead data (connection `state_log` is never surfaced — the feed joins `chit_status`, which connections
  lack). The sender learns of the response from the `connections` table via `GET /connections/list`.
- **`catalogue.js` order/confirm fan-out** — ✅ DONE. Routed through `chit_deliver` in `withEntity(customer)` with
  the OTP consume in the same tx; legacy inline fan-out kept as a pre-b50 fallback (block-level catch on
  undefined_function, so a missing `chit_deliver` rolls back the whole tx incl. the OTP and the fallback redoes it —
  INV-2 preserved). Minor benign delta: `chit_ref` is now `chit_id` (was NULL), matching `/send`.
- **`assist.js`** — ⏳ **REWORK, not a straight migration.** `publish` writes the caller's OWN catalogue (fine →
  `withEntity(me)`). But `/gap` + `/resolve` write into the **help entity's** catalogue from an outside caller, which
  the owner-only WITH CHECK forbids. Gap-capture should **send a chit** to the help desk (`chit_deliver`), not write
  its catalogue. Vestigial (superseded by chit→Task) — rework/retire rather than migrate as-is.

## Migration / deploy run order (for the team)

1. Apply **b48** (cb_app role) → set the role secret → **b50, b51, b52** (additive; safe any time, change nothing until called).
2. Deploy the app code (this branch). `definersReady()` self-detects the fns; pre-application it uses legacy fallbacks.
3. Repoint `DATABASE_URL` → `cb_app` (direct 5432/session DSN) → `node scripts/check-db-role.js` = `cb_app/false/false`.
4. Run `scripts/rls-proof-seed.sql` (as postgres).
5. **RED baseline** (RLS off) → apply **b49 per cluster in enable order**, starting with **`customer_list`** (fully
   covered) → prove **GREEN under FORCE** for each before the next. Do NOT enable `catalogue_items` until the
   privacy decision + assist; do NOT enable `chit_*`/`state_log` until actors + notifications + catalogue-order + governance are migrated.
6. Set `RLS_GUARD=throw` in CI once all Direct-group routes are migrated.

Nothing moves to **[ENFORCED]** until the isolation suite is GREEN under FORCE as `cb_app`.
