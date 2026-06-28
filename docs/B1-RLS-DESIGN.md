# B1 — Postgres Row-Level Security backstop (DESIGN, for review before any code)

**Status:** design only — no migration written yet. Per `CB-CODING-DISCIPLINE.md`, B1 is "done" only when the
A4 isolation suite passes on dev with RLS **forced**. This doc is for Athi + reviewer sign-off on the approach.

## Goal / non-goal
- **Goal:** a database-level net so that a forgotten/incorrect app-layer `WHERE` *cannot* leak across tenants —
  isolation becomes architectural, not disciplinary. App-layer scoping stays (defence in depth).
- **Non-goal:** within-entity per-actor scoping (that's D1). B1 is entity-vs-entity only.

## The mechanism (standard, adapted to this codebase)
1. Each request sets the caller's entity on the DB connection: `SET LOCAL app.current_entity = '<uuid>'`.
2. RLS policies on tenant tables: `USING (entity_id = current_setting('app.current_entity', true)::uuid)`.
3. The entity = what routes already compute: `req.identity.parent_entity_id || req.identity.identity_id`.

### ⚠️ Constraint from THIS code (drives the whole design)
- `db/index.js` connects via Supabase's **transaction pooler (port 6543)** with a **`max: 10`** runtime pool
  (correction: the earlier `max: 1` was only the throwaway connection *probe*). On a transaction pooler a bare
  `SET` does **not** persist (each statement may land on a different backing connection), and on any shared pool
  it could **leak** to the next request. → The context MUST be **`SET LOCAL` inside an explicit transaction**
  (`BEGIN … SET LOCAL … COMMIT`), which is transaction-scoped and auto-resets on commit/rollback.
- ✅ **Built (`withEntity()` in `db/index.js`):** the additive primitive — `withEntity(entityId, fn)` runs `fn`
  inside `withTransaction` after `SELECT set_config('app.current_entity', $1, true)` (= SET LOCAL). Routes opt in.
  Inert until RLS is enabled + the `cb_app` role is in place.
- Today most reads use the global single-statement `query()` (not in a transaction). So **B1 needs an
  entity-context data layer first** — this is **B2 (the choke-point) arriving early**, as the vehicle for B1.

## Part 1 — entity-context data layer (the real work; prerequisite for RLS)
Add a per-request transaction-scoped accessor and route tenant queries through it. `withTransaction` already
exists and is the natural base.

```
// pseudocode — db/index.js
async function withEntity(entityId, fn) {        // wraps withTransaction
  return withTransaction(async (client) => {
    await client.query("SELECT set_config('app.current_entity', $1, true)", [entityId]); // = SET LOCAL
    return fn(client);                           // all queries on THIS client inherit the context
  });
}
```
Rollout of the accessor (incremental, non-breaking):
- A middleware (or per-route wrap) opens `withEntity(callerEntity, …)` and exposes `req.db` (the client).
- Routes migrate `query(...)` → `req.db(...)` for tenant tables, **one route file at a time**.
- **Dev-only guard:** log/assert if a tenant-table query runs *without* `app.current_entity` set — surfaces any
  path that hasn't been migrated yet. (This is the "find the gaps without breaking" step.)

## Part 2 — RLS policies (per table)
Apply `ENABLE` + **`FORCE ROW LEVEL SECURITY`** (so the table owner is subject too), keep app-layer WHERE clauses.

| Group | Tables | Scope column | Policy `USING` |
|---|---|---|---|
| **Direct (simple — do first)** | `chit_header`, `chit_status`, `chit_detail`, `state_log`, `catalogue_items` | `entity_id` | `entity_id = current_setting('app.current_entity',true)::uuid` |
| **Direct (owner)** | `customer_list` | `owner_entity_id` | same on `owner_entity_id` |
| **Indirect (stage 2)** | `schema_fields` (via `schema_id`→`entity_schemas`), `chit_reads` (via `chit_id`/`actor`), `connections`, supplier/relationship tables | — | sub-select / join to the owning entity |
| **Special — `identities`** | entities + actors + customers in one table | `identity_id` / `parent_entity_id` | **see decision below** |
| **Skip (dormant)** | `cb_entity`, `cb_edge`, `cb_chit*` | — | network is dormant (Q3) — no RLS now |

> The exact column per table is confirmed at implementation time from `db/schema.sql` + the migrations
> (`entity_id` appears in schema.sql, b35, b37a, chit_actions, chit_direction, chit_header_role; `owner_entity_id`
> in b36; `parent_entity_id` in schema.sql + b37). This table is the plan, finalised against the live schema.

### ⚠️ `identities` is the hard one — cross-entity discovery is INTENDED
`identities` is read **across tenants on purpose**: `/send` resolves a recipient entity by display name; suppliers
resolve by id/email; catalogue resolves a shop by `bridge_id`. Strict RLS (`identity_id = current OR
parent_entity_id = current`) would **break these legitimate look-ups**. Options (decide before coding):
- **(A, recommended interim)** leave `identities` OUT of strict RLS; rely on app-layer scoping there (it already
  returns only public/needed columns), and put RLS on the *data* tables (chits/catalogue/etc.) which is where the
  leak risk actually lives. Document it as a known carve-out.
- **(B)** a discovery-aware policy: allow read of a minimal "card" (id, bridge_id, display_name) for any entity,
  but restrict actor/customer rows (`parent_entity_id = current`). More work; needs column-level thought.

## Staged rollout (the approved "design-first → safe stages")
- **Stage 0 (held, then dev):** ship Part 1 plumbing + the dev-only "no-context" guard. **No RLS.** Non-breaking.
  Migrate route files to `req.db` until the guard is silent.
- **Stage 1 (dev only):** enable RLS+FORCE+policies on the **Direct** group; run **A4 isolation suite + the
  smoke**. Any breakage = a query path still on global `query()` → migrate it. Reversible (`DISABLE`).
- **Stage 2 (dev):** Indirect tables + the `identities` decision.
- **Prod:** only after dev is green under FORCE, per the prod gate.

## Failure modes & rollback
- A tenant query outside an entity context → returns 0 rows (RLS denies) → caught by Stage-0 guard / A4 before it
  matters. Rollback any stage with `ALTER TABLE … DISABLE ROW LEVEL SECURITY` (policies are additive, reversible).

## Test plan (this IS the definition of done)
- **A4 isolation suite** (next item): for every tenant read+write route, assert caller B cannot see/modify A's
  rows *with RLS forced*. B1 is closed only when A4 is green on dev under FORCE — not on `node --check`.
- Re-run `scripts/smoke-review-fixes.sh` to confirm no regression in the happy path.

## STAGE-0 PREREQUISITE (answered 2026-06-28) — a non-BYPASSRLS app role
**Finding (`scripts/check-db-role.js`):** the API connects as **`postgres`** with **`rolbypassrls = true`**
(`rolsuper = false` — Supabase de-superusered `postgres`, but it keeps BYPASSRLS). **`BYPASSRLS` overrides even
`FORCE ROW LEVEL SECURITY`**, so RLS would do NOTHING for the app today. → **B1 cannot work until the API
connects as a role without BYPASSRLS.**

**Remediation (do on dev, reversible — safe to do NOW because no table has RLS yet, so behaviour is unchanged):**
```sql
-- 1) dedicated app role, no superuser, no bypassrls
CREATE ROLE cb_app LOGIN PASSWORD '<strong-secret>' NOSUPERUSER NOBYPASSRLS;
-- 2) privileges (tables + sequences + future objects)
GRANT USAGE ON SCHEMA public TO cb_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO cb_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO cb_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO cb_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO cb_app;
```
Then point the dev **`DATABASE_URL`** at `cb_app` and **restart + smoke** (app should behave identically — RLS is
not enabled yet). Keep the old `postgres` URL to revert. Setting the custom GUC `app.current_entity` via
`set_config('app.current_entity', …, true)` works for any role (namespaced custom params need no registration).
- **Supabase connection caveat to verify:** a custom role typically uses the **direct** connection (port 5432),
  not the transaction pooler (6543) which expects `postgres`/`<role>.<ref>` formats — confirm the working DSN.
- **Verify the switch:** re-run `node scripts/check-db-role.js` → expect `cb_app / false / false` (RLS ENFORCED ✅).

## OPEN QUESTIONS — remaining (recommended defaults in [brackets]; confirm or override)
1. ✅ **DB role / BYPASSRLS — ANSWERED:** bypassed (`postgres`/BYPASSRLS); needs the `cb_app` role above first.
2. ✅ **`identities` policy — DECIDED:** **carve-out (A)** — leave `identities` out of strict RLS (cross-tenant
   discovery is intended); RLS goes on the data tables where the leak risk lives.
3. ✅ **Connection model — DECIDED:** **yes**, route tenant reads through per-request transactions via
   `withEntity()` (the `max:10` pool handles concurrency; perf impact negligible on dev).
4. ✅ **First cut — DECIDED:** **Stage-1 = the Direct group only** (`chit_header/status/detail`, `state_log`,
   `catalogue_items`) as the proof, before the harder indirect/`identities` work.

## Effort / sequencing
Part 1 plumbing + Stage-0 guard ≈ the bulk of the work (touches `db/index.js` + each route file incrementally).
Stage-1 policies ≈ one small reversible migration. Then A4 proves it. Recommend pairing B1 Part-1 with A4 so the
net and its test land together.
