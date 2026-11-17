-- b797_network_member_rls.sql — DB-85 (25 Oct 2026): b790's five network tables, closed in a file the guard can read.
--
-- ⚠️⚠️ DRAFT — NOT RUN IN PRODUCTION · Athi runs it (Supabase SQL editor, AS postgres). Safe to re-run (ENABLE/FORCE are idempotent, DROP POLICY IF EXISTS then CREATE).
--    Touches no rows. Lands right after rail/return-path (b790 creates these tables; this file needs them).
--
-- WHY. b790 ran in production on 25 Oct. It closes its tables inside a DO-loop with format(), which the file-reading guard (tests/migration-rls.test.js) cannot see,
--   so the guard reported "never closed" for all five. The loop does close them; this file says the same thing in plain ALTER/CREATE POLICY text, so the guard, a reader
--   and a fresh database all agree, and it repairs production if any of the five were ever left open. b790 is not edited (it ran).
-- RLS: ENABLE + FORCE on all five. Platform facts (certificate serials, revoked serials, entity ids + status + counts), no entity_id to isolate on, so no per-shop policy:
--   <table>_owner  postgres (and members)   ALL    — the SECURITY DEFINER trigger ops.f_registry_change writes registry_change as its owner; the editor and migrations run here
--   <table>_app    cb_app                   ALL    — lib/netsync.js, lib/netmember.js, tools/network-cert.cjs and the CTP door call query() with no entity context
--   registry_change_app is SELECT only: cb_app reads the outbox, only the trigger writes it (the table grant is SELECT only as well).
-- OWNER: lib/netmember.js (role, certificate, answers) · lib/netsync.js (the pulls) · tools/network-cert.cjs (the operator's CLI)

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
