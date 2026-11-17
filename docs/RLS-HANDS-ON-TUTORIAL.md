# RLS hands-on — prove it to yourself in 10 minutes

A **self-contained** sandbox you run in the Supabase SQL editor (as `postgres`). It creates its own throwaway table
(`rls_demo`) and role, so it touches **nothing** real. Every scene uses `ROLLBACK` — no permanent change. Run each
numbered block as one "Run", read *what you see* and *what it means*, then move on. Cleanup drops everything.

Two businesses share one table: **acme** and **build**. The whole question: *can `build` see or change `acme`'s data?*
This mirrors the real system 1:1 — `rls_demo` ≈ a chit/catalogue table, `tenant_id` ≈ `entity_id`, `app.tenant` ≈
`app.current_entity` (set by `withEntity()` per request), `rls_demo_app` ≈ the `cb_app` role, the policy ≈ `b49`.

---

### STEP 0 — build the sandbox (run once)
```sql
CREATE TABLE rls_demo (id serial PRIMARY KEY, tenant_id text NOT NULL, secret text NOT NULL);
INSERT INTO rls_demo (tenant_id, secret) VALUES
  ('acme',  'Acme invoice #7 = 9,999,999'),   -- acme's private data
  ('acme',  'Acme customer list'),
  ('build', 'BuildCo order #3');               -- build's private data
CREATE ROLE rls_demo_app NOLOGIN;             -- a normal app role (like cb_app)
GRANT rls_demo_app TO current_user;           -- let postgres step into it with SET ROLE
GRANT SELECT, INSERT, UPDATE, DELETE ON rls_demo TO rls_demo_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO rls_demo_app;
```
*Means:* one shared table, three rows, each stamped with its owner. A normal role that RLS will later apply to.

---

### STEP 1 — WITHOUT RLS: the leak
```sql
SELECT * FROM rls_demo;
```
*See:* **all 3 rows** — acme's AND build's. *Means:* with no protection, any query sees **everyone's** data. If the
app ever forgets its `WHERE tenant_id = me`, BuildCo sees Acme's invoice. Today only the app's own WHERE stops this —
**one bug = a leak.**

```sql
BEGIN;
  UPDATE rls_demo SET secret = 'HACKED BY BUILDCO' WHERE tenant_id = 'acme';
  SELECT * FROM rls_demo WHERE tenant_id = 'acme';    -- acme's secrets now say HACKED
ROLLBACK;                                             -- undo — no harm done
```
*Means:* without RLS nothing stops one tenant from **overwriting** another's data either. The DB does whatever the SQL says.

---

### STEP 2 — turn RLS on + write the rule
```sql
ALTER TABLE rls_demo ENABLE ROW LEVEL SECURITY;
ALTER TABLE rls_demo FORCE  ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON rls_demo
  USING      (tenant_id = current_setting('app.tenant', true))   -- which rows you may SEE / touch
  WITH CHECK (tenant_id = current_setting('app.tenant', true));  -- which rows you may WRITE
```
*Means:* `USING` = the filter the DB silently adds to every read (and to which rows an update/delete can reach).
`WITH CHECK` = the guard on every write (the row must be yours). `current_setting('app.tenant')` = "who am I on this
request" — the app sets it. `FORCE` = apply even to the table's owner.

---

### STEP 3 — the gotcha everyone misses (why "we enabled RLS" can do nothing)
```sql
BEGIN;
  SELECT set_config('app.tenant', 'build', true);   -- I am BuildCo
  SELECT * FROM rls_demo;                            -- ... still all 3 rows?!
ROLLBACK;
```
*See:* **still all 3 rows**, even though RLS is ON. *Means:* you're running as `postgres`, which has **BYPASSRLS** — it
ignores RLS entirely. **This is the trap:** you can "enable RLS" and it silently does nothing, because your app
connects as a bypass/superuser role. The fix is to connect as a **non-bypass role** — which is exactly why we created
`cb_app`. (Verify the real app with `node scripts/check-db-role.js` → must say `bypassrls = false`.)

---

### STEP 4 — run as the app role: RLS bites
**4a — BuildCo's view:**
```sql
BEGIN;
  SET LOCAL ROLE rls_demo_app;                       -- now a normal role (no bypass) — like the app
  SELECT set_config('app.tenant', 'build', true);    -- and I am BuildCo
  SELECT * FROM rls_demo;                             -- EXPECT: only build's 1 row
  SELECT * FROM rls_demo WHERE tenant_id = 'acme';    -- EXPECT: 0 rows (invisible even asked for by name)
ROLLBACK;
```
*Means:* the database itself filters to your tenant. Acme's rows are **invisible** to BuildCo — not "the app remembered
to filter," but "the DB refuses to show them." A forgotten WHERE **cannot** leak.

**4b — BuildCo tries to overwrite Acme:**
```sql
BEGIN;
  SET LOCAL ROLE rls_demo_app;
  SELECT set_config('app.tenant', 'build', true);
  UPDATE rls_demo SET secret = 'HACKED' WHERE tenant_id = 'acme';   -- EXPECT: 0 rows changed
ROLLBACK;
```
*Means:* you can't update what you can't see — the update reaches **0 rows**. Acme is untouched.

**4c — BuildCo tries to forge a row as Acme:**
```sql
BEGIN;
  SET LOCAL ROLE rls_demo_app;
  SELECT set_config('app.tenant', 'build', true);
  INSERT INTO rls_demo (tenant_id, secret) VALUES ('acme', 'forged by buildco');  -- EXPECT: ERROR
ROLLBACK;
```
*See:* **ERROR: new row violates row-level security policy.** *Means:* `WITH CHECK` rejects writing a row that isn't
yours. You cannot even *create* data in someone else's name.

**4d — become Acme: a different, isolated world:**
```sql
BEGIN;
  SET LOCAL ROLE rls_demo_app;
  SELECT set_config('app.tenant', 'acme', true);     -- now I am Acme
  SELECT * FROM rls_demo;                             -- EXPECT: only acme's 2 rows
ROLLBACK;
```
*Means:* **same table, same query, different tenant → different, isolated result.** That's multi-tenancy enforced by
the database. (Notice each scene is `BEGIN … set the tenant … query … ROLLBACK` — that is *literally* what our
`withEntity()` does per request: open a transaction, bind the entity, run, close.)

---

### STEP 5 — cleanup
```sql
DROP TABLE rls_demo;
DROP ROLE rls_demo_app;
```

---

## What you just proved (how to say it to anyone)

> "All our customers' data lives in one database, but every row is stamped with its owner. We turn on Postgres
> Row-Level Security, so the **database itself** filters every query to the caller's own business and rejects any
> write outside it. I proved it: as BuildCo I saw only BuildCo's row — Acme's data was invisible, I couldn't read it
> even by asking for it by name, I couldn't overwrite it (0 rows), and I couldn't forge a row as Acme (rejected). Then
> as Acme I saw only Acme's world. Same table, same query, isolated by the database — not by hoping the app remembered
> a filter. We enforce it by connecting the app as a restricted role (`cb_app`) that RLS applies to; a superuser role
> would bypass it, which is the usual mistake, and we check for exactly that."

**The three "aha"s:** (1) without RLS, one forgotten WHERE leaks everything; (2) RLS on but as a bypass role does
*nothing* — the role matters; (3) as the app role, cross-tenant read **and** write become *structurally* impossible.

## Map to the real system
| Sandbox | Real |
|---|---|
| `rls_demo` table | chit_header / chit_status / catalogue_items / … |
| `tenant_id` | `entity_id` (or `owner_entity_id`) |
| `app.tenant` | `app.current_entity` (set by `withEntity()`) |
| `rls_demo_app` role | `cb_app` |
| `tenant_isolation` policy | the `b49` policies |
| `BEGIN … set … ROLLBACK` | `withEntity(me, …)` |
