-- b303_state_log_append_only.sql — round CO2 (security controls, K6): a chit's history (state_log) can be added to, never rewritten.
--
-- ⚠️⚠️ DRAFT — NOT RUN · Athi runs it (Supabase SQL editor, AS postgres — REVOKE and CREATE TRIGGER need the owner). Written offline,
--    never executed here. Safe to re-run (REVOKE is idempotent; CREATE OR REPLACE FUNCTION; DROP TRIGGER IF EXISTS before CREATE).
--    Until it runs, nothing breaks: no code changes with it — nothing in the app UPDATEs state_log (grep: none), and the only
--    DELETEs are of a DRAFT's own rows, which this migration still allows.
--
-- RLS: unchanged — no policy is added, dropped or relaxed. The trigger function is SECURITY DEFINER (search_path public) only so its
--    one read of chit_header sees the row whatever the session's app.current_entity; it reads, it never writes.
--
-- WHY (docs/research/COMPLIANCE-OBLIGATIONS-2026-10.md in chitbridge-web, K6 / IN-5 / IN-9): the CO0 doc asked for "the b172/b282
--    REVOKE extended to state_log". Checked first (web docs/critique/CO2.md): a plain REVOKE DELETE would break sending a draft —
--    routes/chits.js (promote_draft_id, and DELETE /:chit_id/purge) and chit_deliver (b300, p_clear_first) clear a DRAFT's rows and
--    write them again. So the rule here is the purge route's own rule (routes/chits.js "only drafts can be permanently deleted"),
--    now held by the database:
--      · UPDATE  — revoked from cb_app. Nothing rewrites a history line.
--      · DELETE  — refused for the app (session_user cb_app, which chit_deliver keeps although it runs as definer) unless that
--                  entity's copy of the chit is a Draft. The owner, as postgres in the SQL editor, can still run the test purges
--                  (b171) — a superuser can always disable a trigger, so pretending otherwise would be a false claim.
--
-- ── RUN ORDER ─────────────────────────────────────────────────────────────────────────────────────────────────
--   STEP 1 (preview, read-only) · STEP 2 (apply, one transaction) · STEP 3 (check, read-only)

-- ═════ STEP 1 · PREVIEW (read-only) ═══════════════════════════════════════════════════════════════════════════
SELECT 'state_log present (must be 1)' AS what, (to_regclass('public.state_log') IS NOT NULL)::int AS n
UNION ALL SELECT 'role cb_app present (must be 1)', (SELECT count(*) FROM pg_roles WHERE rolname = 'cb_app')::int
UNION ALL SELECT 'cb_app UPDATE grant on state_log today (1 = will be revoked)',
  (SELECT count(*) FROM information_schema.role_table_grants WHERE table_name = 'state_log' AND grantee = 'cb_app' AND privilege_type = 'UPDATE')::int;

-- ═════ STEP 2 · APPLY (one transaction) ═══════════════════════════════════════════════════════════════════════
BEGIN;

REVOKE UPDATE ON state_log FROM cb_app;

CREATE OR REPLACE FUNCTION state_log_refuse_delete()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF session_user = 'cb_app' AND NOT EXISTS (
       SELECT 1 FROM chit_header h WHERE h.chit_id = OLD.chit_id AND h.entity_id = OLD.entity_id AND h.role = 'Draft') THEN
    RAISE EXCEPTION 'state_log is append-only: a sent chit''s history cannot be deleted (chit %)', OLD.chit_id
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN OLD;
END $$;

DROP TRIGGER IF EXISTS state_log_append_only ON state_log;
CREATE TRIGGER state_log_append_only BEFORE DELETE ON state_log
  FOR EACH ROW EXECUTE FUNCTION state_log_refuse_delete();

DO $$ BEGIN RAISE NOTICE 'b315: state_log — UPDATE revoked from cb_app; DELETE only of a Draft copy''s rows.'; END $$;
COMMIT;

-- ═════ STEP 3 · CHECK (read-only) — the evidence line for the Standards register (cap-standards.js, CO2 rows) ═══
SELECT (SELECT count(*) FROM information_schema.role_table_grants
         WHERE table_name = 'state_log' AND grantee = 'cb_app' AND privilege_type = 'UPDATE') AS update_grant_must_be_0,
       (SELECT count(*) FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid
         WHERE c.relname = 'state_log' AND t.tgname = 'state_log_append_only' AND t.tgenabled <> 'D') AS delete_guard_must_be_1;
