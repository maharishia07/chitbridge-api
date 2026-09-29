-- b270_supplier_list_rls.sql — RUN BY ATHI 2026-09-29 (Supabase editor), after the code that routes every
-- supplier_list statement through withEntity(owner) was deployed (api 3bb2e0b; tests/supplier-list-scope.test.cjs).
-- Who-buys-from-whom was scoped only by the API; at the database level any shop's statement could read every row.
-- The customer_list pattern (b49 §5), on the same key — owner_entity_id, not entity_id.
-- Before/after (Athi's run): supplier_list 929 rows · ops.f_entity_counts 'suppliers' 929 → 929 · ops.f_accounts
-- 907 → 907 (it leaves some accounts out); ops.countable had the enabled 'suppliers' row; all three SECURITY DEFINER
-- readers are owned by a role that bypasses RLS. Source draft: docs/drafts/h2_supplier_list_rls_draft.sql.
BEGIN;
ALTER TABLE supplier_list ENABLE ROW LEVEL SECURITY;
ALTER TABLE supplier_list FORCE  ROW LEVEL SECURITY;
DROP POLICY IF EXISTS rls_entity ON supplier_list;
CREATE POLICY rls_entity ON supplier_list
  USING      (owner_entity_id = NULLIF(current_setting('app.current_entity', true), '')::uuid)
  WITH CHECK (owner_entity_id = NULLIF(current_setting('app.current_entity', true), '')::uuid);
COMMIT;
