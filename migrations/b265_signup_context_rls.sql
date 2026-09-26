-- ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════
-- b265 — signup_context was created WITHOUT ROW LEVEL SECURITY. Close it.
-- ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════
--
-- ✅ CONFIRMED APPLIED — checked live 2026-09-26, read-only: RLS enabled + forced on signup_context, exactly
-- one policy, and cb_app's ONLY privilege on the table is INSERT (no SELECT/UPDATE/DELETE) — matching this
-- file's intent precisely, not just "some RLS exists".
--
-- Athi, the moment he was handed b264 to run: *"264 with RLS?"* — and then, having already run it,
-- *"ohh, just ran 264 without RLS?"*
--
-- He was right to ask, and the answer was no.
--
-- ── ⚠️⚠️⚠️ WHY THIS IS NOT COSMETIC ────────────────────────────────────────────────────────────────────────────
--
-- `signup_context` holds, per identity: the IP address, the user agent, a device JSONB, and the country,
-- currency, timezone and locale the browser claimed at sign-up. It is evidence about a PERSON.
--
-- b264 created it with no `ENABLE ROW LEVEL SECURITY` and no policy. On its own that would merely be an
-- oversight — but `migration_b48_cb_app_role.sql` line 38 sets
--
--     ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO cb_app;
--
-- so the table was granted full CRUD to `cb_app` automatically, the moment it was created. `cb_app` is the role
-- the whole API runs as. One `SELECT * FROM signup_context` returns every person's sign-up IP and device, with
-- no tenant filter, because there was no policy to apply one.
--
-- ⭐ EVERY OTHER TABLE IN THIS PRODUCT CARRIES ITS OWN POLICY (b262, written the same week, carries eighteen
-- RLS statements for four tables). The default grant is what makes a missing one dangerous rather than merely
-- incomplete: a new table is OPEN until somebody closes it, not closed until somebody opens it.
--
-- ── ⭐⭐ THE SHAPE OF THE FIX, AND WHY IT IS THIS SHAPE ─────────────────────────────────────────────────────────
--
-- The application NEVER READS THIS TABLE. Checked across the whole repository: the only reference outside the
-- migration and its test is one `INSERT INTO signup_context` in routes/entities.js. Nothing selects it, nothing
-- updates it, nothing deletes it.
--
-- So the honest policy is not "let each tenant see their own row" — it is that the application role may WRITE
-- this evidence and may never READ it back. Audit evidence the writing process can also rewrite is not evidence.
--
--   · RLS is ENABLEd and FORCEd, so the table owner is bound by it too.
--   · ONE policy, FOR INSERT, WITH CHECK (true) — because the row is written during sign-up, BEFORE any entity
--     context exists. A policy requiring `app.current_entity` here would block people from signing up, which
--     is exactly the sort of "secure" change that takes a product down at 2am.
--   · NO select, update or delete policy exists. With FORCE RLS that makes the table append-only and unreadable
--     through cb_app, whatever the default grant says.
--   · The surplus grants are revoked as well, so the intent is legible in \dp and does not rest on RLS alone.
--
-- Reading it stays possible for the owner and for a reporting role — the same door metrics uses (b151).
--
-- ⚠️ SAFE TO RUN TWICE. Every statement is idempotent.
-- ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════

ALTER TABLE signup_context ENABLE ROW LEVEL SECURITY;
ALTER TABLE signup_context FORCE  ROW LEVEL SECURITY;

-- ⭐ the ONLY thing the application may do: append.
DROP POLICY IF EXISTS signup_context_append ON signup_context;
CREATE POLICY signup_context_append ON signup_context
  FOR INSERT
  WITH CHECK (true);

-- ⚠️⚠️ AND NOTHING ELSE. No SELECT/UPDATE/DELETE policy is created, deliberately — under FORCE ROW LEVEL
-- SECURITY a statement with no permissive policy matches no rows, so cb_app cannot read or alter what it wrote.

REVOKE ALL ON signup_context FROM cb_app;
GRANT INSERT ON signup_context TO cb_app;

-- ── what exists now. ONE result set — the Supabase editor shows only the last. ──────────────────────────────────
SELECT 'b265' AS report,
       (SELECT relrowsecurity  FROM pg_class WHERE oid = 'signup_context'::regclass)      AS rls_enabled,
       (SELECT relforcerowsecurity FROM pg_class WHERE oid = 'signup_context'::regclass)  AS rls_forced,
       (SELECT count(*) FROM pg_policies WHERE tablename = 'signup_context')              AS policies,
       (SELECT string_agg(privilege_type, ',' ORDER BY privilege_type)
          FROM information_schema.role_table_grants
         WHERE table_name = 'signup_context' AND grantee = 'cb_app')                      AS cb_app_may,
       (SELECT count(*) FROM signup_context)                                              AS rows_present;
