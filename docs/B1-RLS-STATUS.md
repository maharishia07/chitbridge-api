# B1 (RLS backstop) — implementation status + questions for review

Hand-off to the reviewing Claude: where B1 stands, what's decided, what's left, and the specific next-step
decisions to advise on. Full design: `docs/B1-RLS-DESIGN.md`. Implementation happens once Athi's team is available.

## TL;DR
Design approved (design-first). The **primitive + the test harness are built**; the **policies + route migration
are not** — and there's a hard prerequisite the role check surfaced: the API connects with **`BYPASSRLS`**, so RLS
is a no-op until a dedicated `cb_app` role is in place. Nothing is enabled yet (held).

## DONE (held on `feat/must-fixes`, not yet enabled on dev)
- **`withEntity()` primitive** (`db/index.js`, additive + inert): runs a route's work in a transaction after
  `SELECT set_config('app.current_entity', <entityId>, true)` (= `SET LOCAL`). Routes opt in; changes nothing today.
- **`db/index.js` now honours a plain `DATABASE_URL`** (direct connect first, Supabase-pooler fallback) — this
  unblocked CI/local Postgres so RLS can actually be tested.
- **A4 isolation harness** = the PROOF for B1: `scripts/isolation-suite.sh` (+ jq-free `scripts/test-dev.js`) —
  asserts B can never read/modify A's data. B1 is "done" only when this stays GREEN with RLS **forced**.
- **Design doc** `docs/B1-RLS-DESIGN.md` (mechanism, table inventory, staged rollout, rollback).

## Q1 ANSWERED — the prerequisite
`scripts/check-db-role.js` on dev returned: role **`postgres`**, `rolsuper=false`, **`rolbypassrls=true`**.
`BYPASSRLS` overrides even `FORCE ROW LEVEL SECURITY`, so **RLS would do nothing as-is**. → Before RLS bites, the
API must connect as a dedicated role **`cb_app` (NOSUPERUSER NOBYPASSRLS)** with table/sequence grants, and
`DATABASE_URL` repointed at it (safe to do early — no behaviour change until RLS is enabled). SQL is in the design
doc. *Supabase caveat:* a custom role may need the direct connection (5432), not the transaction pooler (6543).

## Decisions locked (Q2–Q4, confirmed by Athi)
- **Q2 `identities` → CARVE-OUT** of strict RLS (cross-tenant discovery — resolve recipient/supplier/shop — is
  intended). RLS goes on the *data* tables where the leak risk lives.
- **Q3 → per-request transactions** via `withEntity()` (runtime pool is `max:10`; transaction pooler → `SET LOCAL`
  is the correct, only-viable mechanism).
- **Q4 first cut → the Direct-`entity_id` group only:** `chit_header`, `chit_status`, `chit_detail`, `state_log`,
  `catalogue_items`. (Indirect tables `schema_fields`/`chit_reads`/etc. and `customer_list` are stage 2.)

## NOT done — the implementation work (gated on the dev DB + `cb_app`)
1. Create `cb_app` role on dev + grants + repoint `DATABASE_URL`; verify with `check-db-role.js` (expect ENFORCED).
2. Migrate the Direct-group route reads/writes from the global `query()` to `withEntity()`/a per-request client,
   one route file at a time, with a dev-only "no-context" guard to find gaps (non-breaking).
3. The RLS migration: `ENABLE` + `FORCE ROW LEVEL SECURITY` + `USING (entity_id = current_setting('app.current_entity',true)::uuid)` on the Direct group.
4. Enable on dev, run the A4 isolation suite **under FORCE** — green = done; re-run the smoke for no-regression.

## Risks / things to confirm before coding step 2–3
- **Request-transaction semantics:** wrapping route work in one transaction interacts with existing patterns —
  e.g. `catalogue.js` does a best-effort CRM `INSERT` *after* the main `withTransaction` (would now be inside the
  tx and could roll back the order); some routes call `withTransaction` themselves (nesting). This is why I'm
  leaning **per-route `withEntity()` opt-in** over a global request-wrapping middleware.
- **`identities` carve-out** must be explicit so discovery keeps working.
- **Indirect tables** (no `entity_id`) need join/subquery policies — deferred to stage 2.

## QUESTIONS FOR THE REVIEWER (what to advise)
1. **Migration vehicle:** per-route `withEntity()` opt-in (safer for commit semantics, more edits) vs a global
   per-request entity-context middleware via AsyncLocalStorage (transparent, but changes transaction semantics —
   the best-effort-write problem above)? Recommend per-route; confirm?
2. **Sequencing:** migrate ALL Direct-group routes first, then enable RLS once — or enable RLS table-by-table as
   each route migrates (smaller blast radius, more cycles)?
3. **`cb_app` on Supabase:** known-good way to run a custom non-BYPASSRLS role through Supabase pooling
   (direct 5432 vs Supavisor session mode)? This is the main infra unknown.
4. **Best-effort writes:** is it acceptable to keep post-commit best-effort inserts (CRM add) OUTSIDE the entity
   transaction (i.e. `withEntity` wraps only the authoritative writes), or should they move inside?
5. **Stage-2 indirect tables** (`schema_fields`, `chit_reads`, `customer_list`): join-policy now, or after the
   Direct group proves out?

## Current state
api `feat/must-fixes` (pushed to dev); B1 is design + primitive + harness, **nothing enabled**. The full Track-A
net (A1/A2 done, A3/A4/A5 wired) is in place to prove B1 the moment RLS is turned on under a non-BYPASSRLS role.
