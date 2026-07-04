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
| `chit_header` | chits.js ✅ · governance.js ❌ · catalogue.js order ❌ | governance count + catalogue order fan-out |
| `chit_status` | chits.js ✅ · attachments.js ✅ · actors.js ❌ · notifications.js ❌ · catalogue.js order ❌ | actors, notifications, catalogue order |
| `chit_detail` | chits.js ✅ · catalogue.js order ❌ | catalogue order fan-out |
| `state_log` | chits.js ✅ · actors.js ❌ · connections.js ❌ · notifications.js ❌ · catalogue.js order ❌ | actors, connections, notifications, catalogue order |
| `catalogue_items` | products ✅ · browse reads ✅ (visibility policy) · **assist ❌** | assist help-KB writes — should route via a chit, not a direct write (see below) |
| `customer_list` | send ✅ · relationships ✅ · catalogue ✅ | **none — ready to enable** ✅ |

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

## Remaining route files (not yet migrated — analysis + recommendation)

- **`actors.js`** — task assignment / break / tasks. **Own-entity** (every `chit_status`/`state_log` write is
  `WHERE entity_id = <caller>`; `identities` task-count updates are carve-out). **Safe & decision-free, just large.**
  Recommend: migrate next — wrap the two `withTransaction` blocks (break, status) → `withEntity(me)` and the
  `assign/:chit_id` handler's sequential `db()` calls → `withEntity(me)`. (`db` is just an alias for `query` there.)
- **`catalogue.js` order/confirm fan-out** — a **delivery** (writes customer + shop copies), so conceptually
  `chit_deliver` — BUT it also atomically consumes the customer OTP (`identities` update) and sets **no `direction`**,
  and the sender is a `customer` identity. Not a clean drop-in; needs care to preserve INV-2 atomicity. Recommend a
  focused pass (either extend `chit_deliver` usage with the OTP step, or a dedicated `order_deliver` definer).
- **`connections.js`** — writes `state_log` rows for **both** entities on connect/accept (dual-entity). Needs
  inspection: is this a cross-write (→ `chit_log_targets`-style) or are connection events keyed differently? Flagged.
- **`notifications.js`** — the derived feed reads `state_log`/`chit_status`/`chit_header` with an F3 "only my own
  copy OR a genuine cross-party event" filter — a deliberate **cross-party read**. Needs a definer read or a
  documented scope. Flagged.
- **`governance.js`** — `countChitsToday` counts `chit_header WHERE sender_entity_id = <entity>` for a **governed**
  entity (platform scope, may not be the caller). Likely a platform carve-out or a definer count. Flagged.
- **`assist.js`** — `publish` writes the caller's OWN catalogue (fine → `withEntity(me)`). BUT `/gap` + `/resolve`
  write into the **help entity's** catalogue from an arbitrary/public caller — which the owner-only WITH CHECK now
  forbids unless the platform impersonates the help entity. That's the "nobody writes another's catalogue" anti-
  pattern: gap-capture should **send a chit** to the help desk (`chit_deliver`), not write its catalogue directly.
  Already flagged **vestigial** (superseded by chit→Task). Rework/retire rather than migrate as-is.

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
