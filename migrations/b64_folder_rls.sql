-- b64: RLS on the `folder` table — bring folders up to the platform's isolation standard (identical to b49).
-- The `folder` table holds an entity's private organisation (names + tree of what it filed where), so it must be
-- row-isolated like chit_header/chit_status/etc. — app-`WHERE entity_id` alone is NOT sufficient under this design.
--
-- ⚠️ COUPLING RULE (b49): enable ONLY after every route touching `folder` is on withEntity(). Done:
--    routes/folders.js (create/rename/delete/move/tree/chits) + routes/connectors.js auto-file — all inside withEntity.
-- Predicate matches b49 exactly: entity_id = NULLIF(current_setting('app.current_entity', true), '')::uuid.
-- Idempotent — safe to re-run (e.g. if RLS was enabled by hand alongside b63; this sets the canonical policy).
--
-- Rollback: ALTER TABLE folder DISABLE ROW LEVEL SECURITY; DROP POLICY IF EXISTS rls_entity ON folder;

ALTER TABLE folder ENABLE ROW LEVEL SECURITY;
ALTER TABLE folder FORCE  ROW LEVEL SECURITY;
DROP POLICY IF EXISTS rls_entity ON folder;
CREATE POLICY rls_entity ON folder
  USING      (entity_id = NULLIF(current_setting('app.current_entity', true), '')::uuid)
  WITH CHECK (entity_id = NULLIF(current_setting('app.current_entity', true), '')::uuid);
