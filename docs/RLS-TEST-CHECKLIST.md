# RLS test checklist — inside vs outside, and RED → GREEN

Two kinds of test, don't confuse them:
- **Part A (now):** a **no-regression smoke** through the app — proves the `withEntity()` migration didn't change
  behaviour. RLS is still OFF, so "B can't see A" here is the *app's* WHERE clauses, not RLS.
- **Part B (after `cb_app`):** the **RLS enforcement proof** — proves the *database* blocks cross-tenant access even
  if a WHERE were wrong. This is the real Definition of Done.

Fixed proof-seed tenants (`scripts/rls-proof-seed.sql`): **A = `0a0a0a0a-0000-0000-0000-00000000000a`** (7 chits,
incl. a high-value SENTINEL), **B = `0b0b0b0b-0000-0000-0000-00000000000b`** (3 chits), **C = empty**.

---

## Part A — no-regression smoke (do this now, and after each migration cluster)

| # | Do this | Expect |
|---|---|---|
| 1 | Log in as **entity A**; open inbox / sent / catalogue / tasks | Only A's records, exactly as before the migration |
| 2 | Log in as **entity B** (different login) | Only B's records; **none of A's** |
| 3 | Open a chit's **detail page** as a participant | Header, your line items, your timeline, and the **participants panel** (who-read/accepted) all load |
| 4 | **Send** a chit A → B; check B's inbox and A's sent | Both copies appear; status/messages/disputes/void/priority all still work |
| 5 | Place a **public order** on a shop's storefront (logged out) | Order goes through; shop gets it; you get the token |
| 6 | **Pre-login** (welcome/login/register) — assistant + a public catalogue | You see only **public** Q&A + **public** catalogues; **no** tenant data |
| 7 | Ask the assistant something it can't answer → **Send to help desk** → log in as **GOV-01-Help** | The question is a **task** in GOV-01-Help's inbox; answer + **Publish** serves it |

If all 7 behave as before, the migration is clean. (Nothing here proves RLS yet — that's Part B.)

---

## Part B — RLS enforcement proof (RED → GREEN), after `cb_app` exists

### Setup (team)
1. Run migrations `b48` (cb_app role) → set the role secret → `b50 b51 b52 b53` (definers/seed; additive) → `b49` policies.
2. Load the proof seed **as postgres**: run `scripts/rls-proof-seed.sql`.
3. Verify the runtime role: `node scripts/check-db-role.js` → expect **`cb_app / super=false / bypassrls=false`**.

### The proof — one Supabase SQL session (postgres), toggling role
`postgres` has BYPASSRLS, so it always sees everything (that's the RED baseline). `SET ROLE cb_app` drops into the
non-bypass role so **RLS bites** (that's GREEN). *(Requires `GRANT cb_app TO postgres;` once, or connect directly as
cb_app instead of `SET ROLE`.)*

```sql
-- Bind the session to tenant B, then read as B.
BEGIN;
SELECT set_config('app.current_entity', '0b0b0b0b-0000-0000-0000-00000000000b', true);

-- (RED) as postgres — RLS bypassed:
SELECT count(*) FROM chit_header;                                   -- sees A+B+... (e.g. 10) — LEAK if this were the app
SELECT count(*) FROM chit_header WHERE manual_subject LIKE 'SENTINEL%';  -- sees A's sentinel (1)

SET ROLE cb_app;                                                   -- (GREEN) RLS now enforced

SELECT count(*) FROM chit_header;                                   -- EXPECT 3  (B's own copies only)
SELECT count(*) FROM chit_header WHERE manual_subject LIKE 'SENTINEL%';  -- EXPECT 0  (A's sentinel invisible)
SELECT count(*) FROM chit_status;                                   -- EXPECT 3
SELECT count(*) FROM customer_list;                                 -- EXPECT 1  (B→C only; not A→C)

-- B tries to WRITE into A — must be rejected (WITH CHECK) or affect 0 rows:
UPDATE chit_status SET current_status='cancelled'
 WHERE entity_id='0a0a0a0a-0000-0000-0000-00000000000a';           -- EXPECT 0 rows affected
INSERT INTO catalogue_items (entity_id, item_data, is_active)
 VALUES ('0a0a0a0a-0000-0000-0000-00000000000a','{"x":1}'::jsonb,true);  -- EXPECT ERROR: row violates WITH CHECK

RESET ROLE;
ROLLBACK;                                                          -- read-only proof; discard
```

**Pass = GREEN column matches:** B sees **3 / 0 / 3 / 1**, the sentinel is invisible, and both writes into A fail.
Re-run bound to **A** (`…000a`) and you should see A's **7**. Same seed, opposite result per tenant — *that contrast
is the proof.*

### Catalogue visibility (the one policy that isn't plain entity_id)
```sql
SET ROLE cb_app;
SELECT set_config('app.current_entity', '0b0b0b0b-0000-0000-0000-00000000000b', true);
SELECT count(*) FROM catalogue_items;                              -- B's own items always visible
-- Now make A's default schema public, and B should ALSO see A's active items (browse):
--   (as postgres) UPDATE entity_schemas SET visibility='public'
--     WHERE entity_id='0a0a0a0a-0000-0000-0000-00000000000a' AND is_default=true;
-- back as cb_app bound to B: A's active items now appear; flip A's schema to non-public -> they disappear.
RESET ROLE;
```
Writes stay owner-only regardless of visibility (the `INSERT into A` test above must still fail).

---

## Part C — the no-context guard (dev / CI)
- Set `RLS_GUARD=throw` and run the app/tests. Any tenant-table query that runs **without** `withEntity()` (a
  context-free `query()`) throws loudly — that's a route we missed. With everything migrated, it should be silent.
- Keep `RLS_GUARD=warn` in dev during rollout; set `throw` in CI once all routes are migrated (they now are).

---

## What each result means

| Result | Meaning |
|---|---|
| Part A all pass | Migration is behaviour-preserving; safe to proceed. RLS not yet proven. |
| Part B GREEN matches (3/0/3/1, writes rejected) | **RLS is enforced** — cross-tenant read+write is structurally blocked. **Done** for that table. |
| Part B GREEN shows extra rows / a write succeeds | A policy or a route is wrong — do NOT enable in prod; fix and re-prove. |
| Guard throws in CI | A route still bypasses `withEntity()` — migrate it before enabling its table. |

**Enable order (each proven GREEN before the next):** `customer_list` (fully covered — start here) → `chit_header`
→ `chit_status` → `state_log` → `catalogue_items` → `chit_detail`. Nothing is **[ENFORCED]** until GREEN under FORCE
as `cb_app`.
