-- b844_optional_columns_dropped_from_baseline.sql — DB-3 rehearsal (8 Nov 2026): four columns the code reads (each behind a "is the column there" probe) that production
-- and so the baseline lack, because b275 / b292 / b294 were never run there.
--
-- ⚠️ NOT RUN on production · Athi runs it (SQL editor, AS postgres) after the DB-3 rehearsal file says so. Safe to repeat. Additive only; no rows change.
--
-- WHAT depends on it:
--   folder.kind (b275)                      routes/folders.js:71,87 reads it through to_jsonb (every folder "filed" until it is there); view folders cannot exist without it.
--   test_result.project (b292)              routes/testing.js:138-155 probes information_schema; without it results are written WITHOUT a project and ?project= is ignored.
--   entity_governance.boilerplate_version,  lib/sides.js:302 and lib/govresolve.js:291 ask hasColumns(...) and show no version / blueprint stamp without them.
--     blueprint_key, blueprint_version (b294)
-- Privileges: cb_app and cb_backup hold table-level grants on all three tables (baseline), so the new columns need no grant. folder already has RLS ON + FORCE + rls_entity.
-- ROLL BACK: ALTER TABLE folder DROP CONSTRAINT IF EXISTS folder_kind_chk; ALTER TABLE folder DROP COLUMN IF EXISTS kind; ALTER TABLE test_result DROP COLUMN IF EXISTS project;
--    ALTER TABLE entity_governance DROP COLUMN IF EXISTS boilerplate_version, DROP COLUMN IF EXISTS blueprint_key, DROP COLUMN IF EXISTS blueprint_version;
-- CHECK (read-only): SELECT table_name, column_name FROM information_schema.columns WHERE table_schema = 'public' AND
--    ((table_name = 'folder' AND column_name = 'kind') OR (table_name = 'test_result' AND column_name = 'project') OR
--     (table_name = 'entity_governance' AND column_name IN ('boilerplate_version', 'blueprint_key', 'blueprint_version')));   Expect 5 rows.

ALTER TABLE folder ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'filed';
ALTER TABLE folder DROP CONSTRAINT IF EXISTS folder_kind_chk;
ALTER TABLE folder ADD CONSTRAINT folder_kind_chk CHECK (kind IN ('filed', 'view'));
COMMENT ON COLUMN folder.kind IS 'filed: holds what was moved into it (chit_status.folder_id) · view: shows what its folder_rule rows match; never a move target (was b275).';

ALTER TABLE test_result ADD COLUMN IF NOT EXISTS project text;

ALTER TABLE entity_governance ADD COLUMN IF NOT EXISTS boilerplate_version text;
ALTER TABLE entity_governance ADD COLUMN IF NOT EXISTS blueprint_key text;
ALTER TABLE entity_governance ADD COLUMN IF NOT EXISTS blueprint_version text;
