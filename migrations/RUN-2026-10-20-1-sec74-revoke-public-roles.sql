-- RUN-2026-10-20-1 · SEC-74 · take the Supabase public roles (anon, authenticated) off our tables
-- Why: census 1 shows anon and authenticated with SELECT, INSERT, UPDATE, DELETE, TRUNCATE on every public table, 58 of them without
-- RLS (identities, connector_connection, media_blobs, cb_contact, connections…). Census 3 shows the Data API (role authenticator) is
-- running. Neither web nor api uses the Supabase client or the anon key: the api signs in as cb_app, so this changes nothing for the app.
-- Run in the Supabase SQL editor as postgres. Safe to run again. Touches only the public schema (not auth, storage or realtime).
-- Also recommended: Supabase → Project Settings → Data API → turn it off, or remove `public` from the exposed schemas.

-- 1 · existing objects
REVOKE ALL ON ALL TABLES    IN SCHEMA public FROM anon, authenticated;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM anon, authenticated;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA public FROM anon, authenticated;

-- 2 · objects created later by postgres (our migrations run as postgres)
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE ALL ON TABLES    FROM anon, authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE ALL ON SEQUENCES FROM anon, authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE ALL ON FUNCTIONS FROM anon, authenticated;
-- (supabase_admin also has default grants for these roles; postgres may not be allowed to change them. If the editor refuses a
--  line naming supabase_admin, that is expected: we never create tables as supabase_admin.)

-- PASTE THIS RESULT BACK (read-only): every count 0
SELECT
  (SELECT count(*) FROM pg_tables t WHERE t.schemaname = 'public'
     AND (has_table_privilege('anon', format('%I.%I', t.schemaname, t.tablename), 'SELECT')
       OR has_table_privilege('anon', format('%I.%I', t.schemaname, t.tablename), 'INSERT')
       OR has_table_privilege('anon', format('%I.%I', t.schemaname, t.tablename), 'UPDATE')
       OR has_table_privilege('anon', format('%I.%I', t.schemaname, t.tablename), 'DELETE')))          AS anon_tables,
  (SELECT count(*) FROM pg_tables t WHERE t.schemaname = 'public'
     AND (has_table_privilege('authenticated', format('%I.%I', t.schemaname, t.tablename), 'SELECT')
       OR has_table_privilege('authenticated', format('%I.%I', t.schemaname, t.tablename), 'INSERT')
       OR has_table_privilege('authenticated', format('%I.%I', t.schemaname, t.tablename), 'UPDATE')
       OR has_table_privilege('authenticated', format('%I.%I', t.schemaname, t.tablename), 'DELETE'))) AS authenticated_tables,
  (SELECT count(*) FROM pg_tables t WHERE t.schemaname = 'public'
     AND NOT has_table_privilege('cb_app', format('%I.%I', t.schemaname, t.tablename), 'SELECT'))   AS cb_app_lost_tables;
-- cb_app_lost_tables must be 1 (signup_context, INSERT-only by design), the same as before this file.
