-- b843_cb_entity_root_path.sql — DB-88 / DB-3 rehearsal (8 Nov 2026): cb_entity.root_path and its immutability trigger, missing from a baseline-built database.
--
-- (9 Nov, NET-93: the trigger has one consented door, see the function below. Not on production yet, so edited in place; sit-au re-runs it, safe to repeat.)
--
-- ⚠️ NOT RUN on production · Athi runs it (Supabase SQL editor, AS postgres), one step, after the DB-3 rehearsal file says so. Safe to repeat. Touches no rows
--    (the column is generated from path; the table has a handful of rows).
--
-- WHY. migrations/MANIFEST.md said the baseline carries b243/b244; it does not (production never ran them). GET /api/entities/routing (routes/entities.js:1528,
--    lib/workroute.js) reads c.root_path and FAILS OPEN on every call ("column c.root_path does not exist"): no teams, ever. The trigger function
--    entity_work_routing_target_is_mine then relies on the same tree. The text below is b243 + b244 from migrations/archive/, unchanged in meaning, minus the
--    proof SELECTs. cb_app already holds table-level SELECT/INSERT/UPDATE/DELETE on cb_entity (baseline), so the new column needs no grant.
-- ROLL BACK: DROP TRIGGER IF EXISTS cb_entity_root_immutable ON cb_entity; DROP FUNCTION IF EXISTS cb_entity_root_is_immutable();
--    DROP INDEX IF EXISTS cb_entity_root_path_idx; ALTER TABLE cb_entity DROP COLUMN IF EXISTS root_path;   (the api then answers "no teams" again, as today)
-- CHECK (read-only): SELECT attgenerated FROM pg_attribute WHERE attrelid = 'cb_entity'::regclass AND attname = 'root_path' AND NOT attisdropped;   Expect 's'.
--    SELECT count(*) FROM cb_entity WHERE root_path IS DISTINCT FROM subpath(path, 0, 1);   Expect 0.
--    SELECT tgname FROM pg_trigger WHERE tgrelid = 'cb_entity'::regclass AND tgname = 'cb_entity_root_immutable';   Expect 1 row.
-- RLS: cb_entity is not tenant-scoped (a tree table read outside withEntity by design, routes/entities.js:1517); unchanged here.

DO $$
DECLARE gen char;
BEGIN
  SELECT attgenerated INTO gen FROM pg_attribute WHERE attrelid = 'cb_entity'::regclass AND attname = 'root_path' AND NOT attisdropped;
  IF gen IS NULL THEN
    ALTER TABLE cb_entity ADD COLUMN root_path ltree GENERATED ALWAYS AS (subpath(path, 0, 1)) STORED;
  ELSIF gen <> 's' THEN
    RAISE EXCEPTION 'cb_entity.root_path exists but is NOT generated. Drop it deliberately, then re-run b843.';
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS cb_entity_root_path_idx ON cb_entity (root_path);

COMMENT ON COLUMN cb_entity.root_path IS
  'The network this entity belongs to: the first label of `path`, generated. A root''s root_path is itself. Never written by application code.';

-- NET-93: the ONE door through the rule. A business joins a network (a governance edge the child approved) or leaves it (disconnect) only inside the
-- transaction that names ITS OWN root in the setting cb.net_reroot (src/services/network.js reRootGuard). The setting is local to the transaction, and the
-- rule lets through only rows whose old root or new root IS that label: a shop can never be walked into another network by naming a third root.
CREATE OR REPLACE FUNCTION cb_entity_root_is_immutable() RETURNS trigger
LANGUAGE plpgsql AS $fn$
DECLARE
  old_root ltree := subpath(OLD.path, 0, 1);
  new_root ltree := subpath(NEW.path, 0, 1);
  consented text := nullif(current_setting('cb.net_reroot', true), '');
BEGIN
  IF new_root IS DISTINCT FROM old_root AND consented IS DISTINCT FROM old_root::text AND consented IS DISTINCT FROM new_root::text THEN
    RAISE EXCEPTION 'an entity cannot change networks: % → % (entity %)', old_root, new_root, OLD.bridge_id
      USING HINT = 'Moving WITHIN a network is allowed. Joining or leaving one goes through the approved connection (NET-93), never a bare path update.', ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$fn$;

DROP TRIGGER IF EXISTS cb_entity_root_immutable ON cb_entity;
CREATE TRIGGER cb_entity_root_immutable
  BEFORE UPDATE OF path ON cb_entity
  FOR EACH ROW
  WHEN (OLD.path IS DISTINCT FROM NEW.path)
  EXECUTE FUNCTION cb_entity_root_is_immutable();
