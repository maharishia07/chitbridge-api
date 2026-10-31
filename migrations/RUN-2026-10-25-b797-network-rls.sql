-- RUN-2026-10-25-b797-network-rls.sql — Athi runs this in the Supabase SQL editor AS postgres. Safe to re-run; touches no rows.
-- DB-85 (critic F3): b790 closes its five network tables in a format() loop; this restates ENABLE + FORCE + policies in plain text, so the guard and a fresh database agree
-- and production is certain. b790 is not edited. The source file (migrations/b797_network_member_rls.sql) lands on its branch right after rail/return-path.
-- Policies: <table>_owner for postgres, <table>_app for cb_app (ALL; registry_change SELECT only). The network sync, the cert CLI and the CTP door keep working.

BEGIN;

ALTER TABLE membership_certificate ENABLE ROW LEVEL SECURITY;
ALTER TABLE membership_certificate FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS membership_certificate_owner ON membership_certificate;
CREATE POLICY membership_certificate_owner ON membership_certificate USING (pg_has_role(CURRENT_USER, 'postgres'::name, 'MEMBER'::text)) WITH CHECK (pg_has_role(CURRENT_USER, 'postgres'::name, 'MEMBER'::text));
DROP POLICY IF EXISTS membership_certificate_app ON membership_certificate;
CREATE POLICY membership_certificate_app ON membership_certificate TO cb_app USING (true) WITH CHECK (true);

ALTER TABLE network_revoked ENABLE ROW LEVEL SECURITY;
ALTER TABLE network_revoked FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS network_revoked_owner ON network_revoked;
CREATE POLICY network_revoked_owner ON network_revoked USING (pg_has_role(CURRENT_USER, 'postgres'::name, 'MEMBER'::text)) WITH CHECK (pg_has_role(CURRENT_USER, 'postgres'::name, 'MEMBER'::text));
DROP POLICY IF EXISTS network_revoked_app ON network_revoked;
CREATE POLICY network_revoked_app ON network_revoked TO cb_app USING (true) WITH CHECK (true);

ALTER TABLE registry_change ENABLE ROW LEVEL SECURITY;
ALTER TABLE registry_change FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS registry_change_owner ON registry_change;
CREATE POLICY registry_change_owner ON registry_change USING (pg_has_role(CURRENT_USER, 'postgres'::name, 'MEMBER'::text)) WITH CHECK (pg_has_role(CURRENT_USER, 'postgres'::name, 'MEMBER'::text));
DROP POLICY IF EXISTS registry_change_app ON registry_change;
CREATE POLICY registry_change_app ON registry_change FOR SELECT TO cb_app USING (true);

ALTER TABLE registry_entry ENABLE ROW LEVEL SECURITY;
ALTER TABLE registry_entry FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS registry_entry_owner ON registry_entry;
CREATE POLICY registry_entry_owner ON registry_entry USING (pg_has_role(CURRENT_USER, 'postgres'::name, 'MEMBER'::text)) WITH CHECK (pg_has_role(CURRENT_USER, 'postgres'::name, 'MEMBER'::text));
DROP POLICY IF EXISTS registry_entry_app ON registry_entry;
CREATE POLICY registry_entry_app ON registry_entry TO cb_app USING (true) WITH CHECK (true);

ALTER TABLE registry_cursor ENABLE ROW LEVEL SECURITY;
ALTER TABLE registry_cursor FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS registry_cursor_owner ON registry_cursor;
CREATE POLICY registry_cursor_owner ON registry_cursor USING (pg_has_role(CURRENT_USER, 'postgres'::name, 'MEMBER'::text)) WITH CHECK (pg_has_role(CURRENT_USER, 'postgres'::name, 'MEMBER'::text));
DROP POLICY IF EXISTS registry_cursor_app ON registry_cursor;
CREATE POLICY registry_cursor_app ON registry_cursor TO cb_app USING (true) WITH CHECK (true);

COMMIT;

-- ═════ check: every row must say true (RLS enabled AND forced, at least one policy) ═════
SELECT c.relname AS what, c.relrowsecurity AND c.relforcerowsecurity AS ok,
       (SELECT count(*) FROM pg_policies p WHERE p.schemaname = 'public' AND p.tablename = c.relname) AS policies
FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public' AND c.relname IN ('membership_certificate', 'network_revoked', 'registry_change', 'registry_entry', 'registry_cursor')
ORDER BY c.relname;
-- expect 5 rows, ok = true on all, policies = 2 on each.
