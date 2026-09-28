-- h2_supplier_list_rls_draft.sql — DRAFT for Athi, NOT RUN. supplier_list gets ROW LEVEL SECURITY (FORCE).
--
-- ⚠️⚠️⚠️ RUN ONLY AFTER the night-server commit that routes every supplier_list statement through withEntity is
-- DEPLOYED to Railway (check: GET /health → "commit" is that commit or later). Run it before, and the suppliers
-- screen reads NOTHING and "add a supplier" fails WITH CHECK — cb_app is NOBYPASSRLS and the old code set no
-- app.current_entity for these statements.
--
-- WHY: who-buys-from-whom is a competitive fact. Today only the API scopes it; at the database level any
-- statement from any shop could read every row. customer_list has been FORCE RLS since b49; this is the same
-- pattern, on the same key (owner_entity_id — NOT entity_id, the trap b49 names).
--
-- WHAT THE CODE ALREADY DOES (night-server, tests/supplier-list-scope.test.cjs guards it):
--   · routes/relationships.js — all nine statements run in withEntity(owner) (were bare query()).
--   · routes/adopt.js, routes/chits.js, lib/rootlink.js — already withEntity(owner).
--   · routes/entities.js (operator list, reads ACROSS shops) — counts through ops.f_entity_counts() (b241, SECURITY
--     DEFINER); 'suppliers' is ALREADY a row in ops.countable (b241 line 102), so NO insert is needed here.
--   · SECURITY DEFINER functions that read supplier_list: enquiry_message_deliver (b162), ops.f_accounts (b224),
--     ops.f_entity_counts (b241). They read through FORCE only if their OWNER bypasses RLS — b241's verification
--     proved that for its function; the checks below prove it for all three, before and after.
--
-- ── 0 · BEFORE: the numbers to compare against (run these first, keep the output) ──────────────────────────
SELECT count(*) AS supplier_rows, count(DISTINCT owner_entity_id) AS owners FROM supplier_list;
SELECT sum(n) AS counted_by_surface FROM ops.f_entity_counts() WHERE metric = 'suppliers';
SELECT sum(suppliers) AS counted_by_accounts FROM ops.f_accounts();
SELECT metric, table_name, owner_column, enabled FROM ops.countable WHERE metric = 'suppliers';   -- expect 1 row, enabled
SELECT p.proname, pg_get_userbyid(p.proowner) AS owner, r.rolbypassrls, r.rolsuper
  FROM pg_proc p JOIN pg_roles r ON r.oid = p.proowner
 WHERE p.proname IN ('enquiry_message_deliver', 'f_accounts', 'f_entity_counts');             -- expect bypass or super

BEGIN;

-- ── 1 · the policy, exactly as customer_list's (b49 §5) ─────────────────────────────────────────────────────
ALTER TABLE supplier_list ENABLE ROW LEVEL SECURITY;
ALTER TABLE supplier_list FORCE  ROW LEVEL SECURITY;
DROP POLICY IF EXISTS rls_entity ON supplier_list;
CREATE POLICY rls_entity ON supplier_list
  USING      (owner_entity_id = NULLIF(current_setting('app.current_entity', true), '')::uuid)
  WITH CHECK (owner_entity_id = NULLIF(current_setting('app.current_entity', true), '')::uuid);

-- ── 2 · the counting surface already lists it — asserted, never assumed ─────────────────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM ops.countable WHERE metric = 'suppliers' AND table_name = 'supplier_list'
                  AND owner_column = 'owner_entity_id' AND enabled) THEN
    RAISE EXCEPTION 'ops.countable has no enabled suppliers row — the operator list would count 0 under FORCE';
  END IF;
END $$;

COMMIT;

-- ── 3 · AFTER: every number must match step 0 ────────────────────────────────────────────────────────────────
SELECT sum(n) AS counted_by_surface FROM ops.f_entity_counts() WHERE metric = 'suppliers';          -- = before
SELECT sum(suppliers) AS counted_by_accounts FROM ops.f_accounts();                                  -- = before
-- as the app role, with no shop set: NOTHING is visible (the point of FORCE)
SET ROLE cb_app;
SELECT count(*) AS visible_with_no_shop FROM supplier_list;                                           -- expect 0
-- as the app role, for one real shop: exactly that shop's rows
SELECT set_config('app.current_entity', (SELECT owner_entity_id::text FROM supplier_list LIMIT 1), false);
SELECT count(*) AS visible_for_one_shop, count(DISTINCT owner_entity_id) AS owners_seen FROM supplier_list;  -- owners_seen = 1
RESET ROLE;
SELECT set_config('app.current_entity', '', false);

-- ── 4 · ROLLBACK, if anything above disagrees ────────────────────────────────────────────────────────────────
-- ALTER TABLE supplier_list NO FORCE ROW LEVEL SECURITY;
-- ALTER TABLE supplier_list DISABLE ROW LEVEL SECURITY;
-- DROP POLICY IF EXISTS rls_entity ON supplier_list;
