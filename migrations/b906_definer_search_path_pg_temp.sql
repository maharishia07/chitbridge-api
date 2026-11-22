-- b906_definer_search_path_pg_temp.sql — every SECURITY DEFINER function pins pg_temp last in its search_path (VERIFY-EL-DB A5, batch 1128).
--
-- ⚠️ NOT RUN · Athi runs it (Supabase SQL editor, AS postgres), SIT first. Safe to repeat (a function that already lists pg_temp, or has an empty search_path, is skipped).
-- WHY  15 definers carry `SET search_path TO 'public'` with no pg_temp. Postgres searches the session's temporary schema FIRST for relations when it is not listed, so a role that may create
--      temp tables could plant `chit_disputes` as a temp table and have a definer (owner rights, bypasses RLS) read the planted rows. Listing pg_temp LAST closes it (PostgreSQL docs, CREATE FUNCTION,
--      "Writing SECURITY DEFINER Functions Safely").
-- WHAT  a loop over pg_proc for definers in public, ops and metrics whose own search_path setting has no pg_temp: ALTER FUNCTION ... SET search_path = <the schemas it already had>, pg_temp.
--       Only the setting changes: the body, owner, grants and result are untouched. An empty search_path is already safe and is left alone. A definer with NO search_path setting at all is only
--       reported (NOTICE) for a decision. The NOTICE lines list every function changed.
-- ORDER any time. RLS: untouched.
-- ROLL BACK: ALTER FUNCTION <name>(<args>) SET search_path = <old list>;   (the old list is in each NOTICE line of this file)
-- CHECK (read-only): SELECT p.oid::regprocedure FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname IN ('public','ops','metrics') AND p.prosecdef
--        AND NOT EXISTS (SELECT 1 FROM unnest(p.proconfig) c WHERE c LIKE 'search_path=%pg\_temp%' OR c = 'search_path=""');   (0 rows)
BEGIN;
SET LOCAL lock_timeout = '5s';
DO $$
DECLARE r record; old text;
BEGIN
  FOR r IN SELECT p.oid::regprocedure AS sig, (SELECT substr(c, 13) FROM unnest(p.proconfig) c WHERE c LIKE 'search_path=%' LIMIT 1) AS sp
             FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
            WHERE n.nspname IN ('public','ops','metrics') AND p.prosecdef
              AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.objid = p.oid AND d.deptype = 'e')
  LOOP
    old := r.sp;
    IF old IS NULL THEN
      RAISE NOTICE 'b906: % has NO search_path setting at all: left for a decision (a definer without one runs on the caller path)', r.sig;
    ELSIF old = '""' OR old = '' OR old LIKE '%pg_temp%' THEN
      CONTINUE;
    ELSE
      EXECUTE format('ALTER FUNCTION %s SET search_path = %s, pg_temp', r.sig, old);
      RAISE NOTICE 'b906: % search_path % -> %, pg_temp', r.sig, old, old;
    END IF;
  END LOOP;
END $$;
COMMIT;
