-- b903_drop_cb_entity_password_hash.sql — drop the unused cb_entity.password_hash column (VERIFY-GF-DB F1, batch 1128).
--
-- ⚠️ NOT RUN anywhere · Athi runs it (Supabase SQL editor, AS postgres), SIT first. Safe to repeat (column already gone = nothing to do).
-- WHY  a legacy credential column on a table with no RLS (cb_entity is "shared"): no writer, no reader in routes/lib/src/db/tools (git grep: 0 hits), yet any
--      cross-shop cb_entity read could carry it. Removing it is the fix; the REVOKE comes first so cb_app cannot read it even if the DROP is held back.
-- DATA GUARD: the DROP happens only when every row is NULL. If any row holds a value the DO block RAISEs and the whole file stops (nothing dropped);
--      the REVOKE has been rolled back with it. Send Athi the count (SELECT count(*) FROM cb_entity WHERE password_hash IS NOT NULL) and decide before any retry. Nothing is deleted without that.
-- RLS: no table, no policy changed; a column privilege goes, then the column.
-- ROLL BACK: ALTER TABLE public.cb_entity ADD COLUMN password_hash text;  GRANT SELECT (password_hash) ON public.cb_entity TO cb_app;   (it was always NULL, so nothing to restore)
-- CHECK (read-only): SELECT column_name FROM information_schema.columns WHERE table_name = 'cb_entity' AND column_name = 'password_hash';   (0 rows)
BEGIN;
SET LOCAL lock_timeout = '5s';
DO $$
DECLARE n bigint;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'cb_entity' AND column_name = 'password_hash') THEN
    RAISE NOTICE 'b903: cb_entity.password_hash already gone, nothing to do';
    RETURN;
  END IF;
  EXECUTE 'SELECT count(*) FROM public.cb_entity WHERE password_hash IS NOT NULL' INTO n;
  IF n > 0 THEN
    RAISE EXCEPTION 'b903 STOPPED: % cb_entity row(s) hold a password_hash; nothing dropped. Athi decides.', n;
  END IF;
  EXECUTE 'REVOKE SELECT (password_hash) ON public.cb_entity FROM cb_app';
  EXECUTE 'ALTER TABLE public.cb_entity DROP COLUMN password_hash';
END $$;
COMMIT;
