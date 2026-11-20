-- b889_cb_entity_root_immutable_restore_safe.sql — the root-immutability trigger survives pg_dump / pg_restore (upgrade rehearsal 20 Nov 2026, finding 3; DB-3).
--
-- ⚠️ NOT RUN anywhere · Athi runs it (Supabase SQL editor, AS postgres), SIT first. Safe to repeat (CREATE OR REPLACE, DROP TRIGGER IF EXISTS, then CREATE). Touches no rows, no column, no grant.
-- Before AND after it the rule is the same: an entity may move within its network and may never leave it (b243/b244/b843). The api is correct either way.
-- WHY. pg_dump writes the trigger as `WHEN (old.path IS DISTINCT FROM new.path)` and pg_restore replays it with an EMPTY search_path. The `=` on ltree lives in schema public (extension ltree), so the
--    CREATE TRIGGER failed with "operator does not exist: public.ltree = public.ltree" and a restored database silently lacked the guard (table counts, functions, roles and policies all still matched).
-- WHAT. (1) the WHEN clause compares the two paths as text (a pg_catalog operator, found with any search_path; same truth: equal ltrees have equal text); (2) the function pins SET search_path = public, pg_catalog
--    so subpath() and the ltree operators in its body resolve however the caller was connected. Nothing else in the function changes.
-- ROLL BACK: re-run migrations/b843_cb_entity_root_path.sql (it recreates the function and trigger in their earlier form; a restore of a dump then loses the trigger again).
-- CHECK (read-only): SELECT pg_get_triggerdef(oid) LIKE '%::text%' AS ok FROM pg_trigger WHERE tgname = 'cb_entity_root_immutable';   (true)
--    SELECT proconfig::text LIKE '%search_path%' AS ok FROM pg_proc WHERE proname = 'cb_entity_root_is_immutable';   (true)
-- RLS: unchanged (cb_entity is not tenant-scoped, see b843).

BEGIN;
SET LOCAL lock_timeout = '5s';   -- a busy table fails the run fast (nothing changes; run it again)

CREATE OR REPLACE FUNCTION cb_entity_root_is_immutable() RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_catalog AS $fn$
BEGIN
  IF subpath(NEW.path, 0, 1) IS DISTINCT FROM subpath(OLD.path, 0, 1) THEN
    RAISE EXCEPTION 'an entity cannot change networks: % → % (entity %)', subpath(OLD.path, 0, 1), subpath(NEW.path, 0, 1), OLD.bridge_id
      USING HINT = 'Moving WITHIN a network is allowed. Leaving one is a separation: create a new entity.', ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$fn$;

DROP TRIGGER IF EXISTS cb_entity_root_immutable ON cb_entity;
CREATE TRIGGER cb_entity_root_immutable
  BEFORE UPDATE OF path ON cb_entity
  FOR EACH ROW
  WHEN (OLD.path::text IS DISTINCT FROM NEW.path::text)
  EXECUTE FUNCTION cb_entity_root_is_immutable();
COMMIT;
