-- migration_b49_rls_policies.sql — B1 RLS · STEP E: ENABLE + FORCE RLS + per-table policy on the Direct group.
-- Run as postgres (DDL needs the table owner). Policies key on entity_id (row-level) -> robust to chit_detail
-- column growth. Predicate: entity_id = current_setting('app.current_entity', true)::uuid ; customer_list uses
-- owner_entity_id (the one predicate trap — NOT a copy-paste). Explicit WITH CHECK on every table (write-time).
--
-- ⚠️ NOT ENFORCED until (a) the app connects as cb_app (postgres/BYPASSRLS makes these a NO-OP), AND (b) the
--    isolation suite is GREEN under FORCE (`node --check` is never the done-signal).
-- ⚠️ COUPLING RULE: a table may be enabled only AFTER every route that queries it is on withEntity() (Step D) —
--    else an un-migrated route runs context-free, fails closed, and the feature returns EMPTY. Apply the blocks
--    below INCREMENTALLY in the enable order (header → status → state_log → catalogue_items → customer_list →
--    chit_detail), proving each GREEN under FORCE (Step F) before the next. This file is the ready SQL for that.
--
-- Rollback (per table): ALTER TABLE <t> DISABLE ROW LEVEL SECURITY; DROP POLICY IF EXISTS rls_entity ON <t>;

-- ── 1. chit_header ────────────────────────────────────────────────────────────
ALTER TABLE chit_header ENABLE ROW LEVEL SECURITY;
ALTER TABLE chit_header FORCE  ROW LEVEL SECURITY;
DROP POLICY IF EXISTS rls_entity ON chit_header;
CREATE POLICY rls_entity ON chit_header
  USING      (entity_id = current_setting('app.current_entity', true)::uuid)
  WITH CHECK (entity_id = current_setting('app.current_entity', true)::uuid);

-- ── 2. chit_status ────────────────────────────────────────────────────────────
ALTER TABLE chit_status ENABLE ROW LEVEL SECURITY;
ALTER TABLE chit_status FORCE  ROW LEVEL SECURITY;
DROP POLICY IF EXISTS rls_entity ON chit_status;
CREATE POLICY rls_entity ON chit_status
  USING      (entity_id = current_setting('app.current_entity', true)::uuid)
  WITH CHECK (entity_id = current_setting('app.current_entity', true)::uuid);

-- ── 3. state_log ──────────────────────────────────────────────────────────────
ALTER TABLE state_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE state_log FORCE  ROW LEVEL SECURITY;
DROP POLICY IF EXISTS rls_entity ON state_log;
CREATE POLICY rls_entity ON state_log
  USING      (entity_id = current_setting('app.current_entity', true)::uuid)
  WITH CHECK (entity_id = current_setting('app.current_entity', true)::uuid);

-- ── 4. catalogue_items ────────────────────────────────────────────────────────
ALTER TABLE catalogue_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE catalogue_items FORCE  ROW LEVEL SECURITY;
DROP POLICY IF EXISTS rls_entity ON catalogue_items;
CREATE POLICY rls_entity ON catalogue_items
  USING      (entity_id = current_setting('app.current_entity', true)::uuid)
  WITH CHECK (entity_id = current_setting('app.current_entity', true)::uuid);

-- ── 5. customer_list — DISTINCT predicate: owner_entity_id (the trap) ──────────
ALTER TABLE customer_list ENABLE ROW LEVEL SECURITY;
ALTER TABLE customer_list FORCE  ROW LEVEL SECURITY;
DROP POLICY IF EXISTS rls_entity ON customer_list;
CREATE POLICY rls_entity ON customer_list
  USING      (owner_entity_id = current_setting('app.current_entity', true)::uuid)
  WITH CHECK (owner_entity_id = current_setting('app.current_entity', true)::uuid);

-- ── 6. chit_detail — LAST (details page keeps gaining columns; policy stays trivial entity_id) ──
ALTER TABLE chit_detail ENABLE ROW LEVEL SECURITY;
ALTER TABLE chit_detail FORCE  ROW LEVEL SECURITY;
DROP POLICY IF EXISTS rls_entity ON chit_detail;
CREATE POLICY rls_entity ON chit_detail
  USING      (entity_id = current_setting('app.current_entity', true)::uuid)
  WITH CHECK (entity_id = current_setting('app.current_entity', true)::uuid);
