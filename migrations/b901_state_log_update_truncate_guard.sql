-- b901_state_log_update_truncate_guard.sql — RAIL-1128 F8b: the chit history (state_log) is append-only for EVERY login, not only the app role.
--
-- ⚠️ NOT RUN · Athi runs it (Supabase SQL editor, AS postgres). Safe to repeat (CREATE OR REPLACE, DROP TRIGGER IF EXISTS). Touches no rows, no policy, no grant.
--
-- WHY. The existing guard (state_log_append_only, BEFORE DELETE, baseline 000:1647) fires only when session_user = 'cb_app', and cb_app is granted SELECT, INSERT, DELETE (no UPDATE). A support or migration
--   login (not cb_app) could therefore EDIT a sent chit's history (UPDATE) or empty it (TRUNCATE), which no trigger stopped. This adds the two missing guards. Found by the 21 Nov critic (VERIFY-EL-RAIL F8b).
-- WHAT. BEFORE UPDATE (row): refused for every session user — nothing in the api, the tools or the purge scripts updates state_log (git grep, 21 Nov: none). BEFORE TRUNCATE (statement): refused for every session user.
--   DELETE is unchanged (cb_app only, a Draft's history excepted): the test-data purge scripts delete as postgres and keep working.
-- A genuine repair is done by the owner in one transaction: ALTER TABLE state_log DISABLE TRIGGER state_log_no_update; <fix>; ALTER TABLE state_log ENABLE TRIGGER state_log_no_update;  (leaves a trace in the DDL log).
-- ROLL BACK:  DROP TRIGGER IF EXISTS state_log_no_update ON public.state_log; DROP TRIGGER IF EXISTS state_log_no_truncate ON public.state_log; DROP FUNCTION IF EXISTS public.state_log_refuse_change();
BEGIN;

CREATE OR REPLACE FUNCTION public.state_log_refuse_change() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
BEGIN
  IF TG_OP = 'TRUNCATE' THEN
    RAISE EXCEPTION 'state_log is append-only: it cannot be truncated' USING ERRCODE = 'insufficient_privilege';
  END IF;
  RAISE EXCEPTION 'state_log is append-only: a chit''s history cannot be edited (chit %)', OLD.chit_id USING ERRCODE = 'insufficient_privilege';
END $$;

DROP TRIGGER IF EXISTS state_log_no_update ON public.state_log;
CREATE TRIGGER state_log_no_update BEFORE UPDATE ON public.state_log FOR EACH ROW EXECUTE FUNCTION public.state_log_refuse_change();
DROP TRIGGER IF EXISTS state_log_no_truncate ON public.state_log;
CREATE TRIGGER state_log_no_truncate BEFORE TRUNCATE ON public.state_log FOR EACH STATEMENT EXECUTE FUNCTION public.state_log_refuse_change();

COMMIT;
