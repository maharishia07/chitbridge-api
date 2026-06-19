-- B3.10a — freeze-at-send columns (INV-3 / A10). Additive, safe to re-run.
-- The spine's live_schema claimed these existed on chit_header; they did NOT — this closes that drift.

-- entity_schemas needs a version to freeze (append-only later; all current rows = v1)
ALTER TABLE entity_schemas ADD COLUMN IF NOT EXISTS schema_version INT NOT NULL DEFAULT 1;

-- chit_header captures the frozen schema snapshot + who pressed send
ALTER TABLE chit_header ADD COLUMN IF NOT EXISTS schema_version      INT;
ALTER TABLE chit_header ADD COLUMN IF NOT EXISTS schema_id           UUID;
ALTER TABLE chit_header ADD COLUMN IF NOT EXISTS created_by_actor_id UUID;

-- Verify
SELECT column_name FROM information_schema.columns
WHERE table_name='chit_header' AND column_name IN ('schema_version','schema_id','created_by_actor_id')
UNION ALL
SELECT 'entity_schemas.schema_version' WHERE EXISTS (
  SELECT 1 FROM information_schema.columns
  WHERE table_name='entity_schemas' AND column_name='schema_version');
