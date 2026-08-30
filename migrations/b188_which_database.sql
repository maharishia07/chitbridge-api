-- ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════
-- b188 — WHICH DATABASE IS THIS? Read-only. Changes nothing.
-- ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════
--
-- ⚠️⚠️ 2026-08-30. Supabase logged out; reopening it landed on a DIFFERENT PROJECT, and an afternoon of
-- migration errors followed — missing relations, and a `42704 role "cb_app" does not exist` that sent me
-- chasing a systemic grant problem that was never there.
--
-- ⭐ THE APP CONNECTS TO SUPABASE PROJECT  bzacyrdrnzdbficjplcn
--   host  aws-1-ap-south-1.pooler.supabase.com:6543   (transaction pooler)
--   user  cb_app.bzacyrdrnzdbficjplcn                 (pooler format: <role>.<project-ref>)
--   db    postgres                                    (Supabase names every database this — the NAME does
--                                                      not identify anything; the PROJECT REF does)
--
-- The SQL editor for it is  https://supabase.com/dashboard/project/bzacyrdrnzdbficjplcn/sql
--
-- Run this whenever the editor and the app disagree about what exists. If has_chit_header comes back false,
-- stop — that is not the app database and nothing else should be run against it.
-- ONE result set, one row.

SELECT
  current_database()                                                    AS database_name,
  current_user                                                          AS connected_as,
  current_setting('search_path')                                        AS search_path,
  (SELECT count(*) FROM information_schema.tables
    WHERE table_schema = 'public')                                      AS public_tables,
  /* Landmarks. chit_header is the oldest table in the product — if THAT is missing, this is not the app's
     database at all. The register tables are what today's work turned on. */
  to_regclass('chit_header')        IS NOT NULL                         AS has_chit_header,
  to_regclass('chit_line')          IS NOT NULL                         AS has_chit_line,
  to_regclass('identities')         IS NOT NULL                         AS has_identities,
  to_regclass('chit_line_raida')    IS NOT NULL                         AS has_b182_raida,
  to_regclass('register_entry')     IS NOT NULL                         AS has_b185_entry,
  to_regclass('register_subject')   IS NOT NULL                         AS has_b185_subject,
  to_regclass('register_attachable') IS NOT NULL                        AS has_b185_attachable,
  /* Did either half-run of b186 leave anything behind? Both errored, so both should have rolled back — but
     "should have" is not evidence. */
  (SELECT count(*) FROM pg_roles WHERE rolname = 'cb_app')              AS cb_app_role_exists;
