-- RUN-2026-10-20-0 · CNT-1 · the read-only role the nightly backup signs in with (DEPLOY-RUNBOOK "Nightly backup", step 1)
-- Run ONCE in the Supabase SQL editor as postgres. Safe to run again: an existing role only gets its password reset.
-- BEFORE YOU RUN: replace CHANGE_ME_LONG_RANDOM below with a long random password. Do not save the password in this file
-- or paste it anywhere else; it goes only into the engines repo secret BACKUP_DATABASE_URL.
-- It reads only: SELECT on tables and sequences. BYPASSRLS because pg_dump refuses tables with row-level security otherwise.
-- If Supabase refuses BYPASSRLS, stop and tell Claude (the fallback is the postgres role's URI; the job still only reads).

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'cb_backup') THEN
    ALTER ROLE cb_backup LOGIN PASSWORD 'CHANGE_ME_LONG_RANDOM' BYPASSRLS;
  ELSE
    CREATE ROLE cb_backup LOGIN PASSWORD 'CHANGE_ME_LONG_RANDOM' BYPASSRLS;
  END IF;
END $$;

GRANT USAGE ON SCHEMA public TO cb_backup;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO cb_backup;
GRANT SELECT ON ALL SEQUENCES IN SCHEMA public TO cb_backup;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT SELECT ON TABLES TO cb_backup;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT SELECT ON SEQUENCES TO cb_backup;

-- PASTE THIS RESULT BACK (read-only check): one row, bypassrls true, unreadable_tables 0
SELECT r.rolname,
       r.rolcanlogin  AS can_login,
       r.rolbypassrls AS bypassrls,
       (SELECT count(*) FROM pg_tables t
         WHERE t.schemaname = 'public'
           AND NOT has_table_privilege('cb_backup', format('%I.%I', t.schemaname, t.tablename), 'SELECT')) AS unreadable_tables,
       (SELECT count(*) FROM pg_tables t
         WHERE t.schemaname = 'public'
           AND (has_table_privilege('cb_backup', format('%I.%I', t.schemaname, t.tablename), 'INSERT')
             OR has_table_privilege('cb_backup', format('%I.%I', t.schemaname, t.tablename), 'UPDATE')
             OR has_table_privilege('cb_backup', format('%I.%I', t.schemaname, t.tablename), 'DELETE'))) AS writable_tables
  FROM pg_roles r
 WHERE r.rolname = 'cb_backup';
