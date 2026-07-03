-- migration_b48_cb_app_role.sql — B1 RLS · STEP A: a dedicated NOSUPERUSER NOBYPASSRLS app role (`cb_app`).
-- Run as postgres/admin. SAFE NOW: no table has RLS yet, so behaviour is unchanged until policies are enabled.
-- Why: the API currently connects as `postgres` with BYPASSRLS=true, which overrides even FORCE RLS -> RLS is a
-- no-op until the app connects as a role that RLS actually bites. `cb_app` is that role.
--
-- ============================================================================================================
-- ⚠️ PLATFORM-CONFIGURABILITY (Athi, 2026-07-04) — keep anything environment-specific in CONFIG, never hardcoded,
--    so migrating to another Postgres/cloud is trivial and nothing here is tightly bound to Supabase:
--    • ROLE PASSWORD  -> comes from a SECRET, set separately (see step 3). NEVER commit it.
--    • APP CONNECTION -> the ONLY place the connection lives is the app's `DATABASE_URL` env var. Repointing to
--                        cb_app is a CONFIG change (an env swap), not a code change.
--    • POOLER vs DIRECT (Supabase 6543 vs 5432 / Supavisor session) -> a CONNECTION-STRING concern that lives in
--                        `DATABASE_URL`, NOT in SQL or app code. A custom NOBYPASSRLS role typically needs the
--                        direct 5432 / session DSN. Flag every Supabase-ism; isolate it in env.
--    • Nothing platform-specific belongs in application code — connection details stay behind `DATABASE_URL`
--      (and, for storage etc., behind the existing adapters). Build the interface, wire one backend, swap later.
--    Apply this rule to EVERY migration/artifact: platform-dependent = configurable = easy to migrate.
-- ============================================================================================================

BEGIN;

-- 1) Dedicated app role (idempotent). LOGIN, but NO superuser, NO bypassrls.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'cb_app') THEN
    CREATE ROLE cb_app LOGIN NOSUPERUSER NOBYPASSRLS;
  ELSE
    ALTER ROLE cb_app LOGIN NOSUPERUSER NOBYPASSRLS;
  END IF;
END $$;

-- 2) Privileges — tables + sequences + FUTURE objects (so new tables are covered without re-granting).
--    RLS restricts ROWS; these grants allow the OPERATION. The app queries many tables, so grant broadly;
--    RLS then bites only on the tables that have policies (the Direct group, added in Step E).
GRANT USAGE ON SCHEMA public TO cb_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO cb_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO cb_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO cb_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO cb_app;

COMMIT;

-- 3) Set the password from your SECRET, separately (keep it out of git):
--      ALTER ROLE cb_app PASSWORD '<from-secret-manager>';
--
-- 4) THEN (config, not SQL): point dev `DATABASE_URL` at cb_app on the DIRECT (5432)/session DSN; restart; smoke.
--    Keep the old postgres URL to revert instantly. No RLS is enabled yet -> app behaviour must be IDENTICAL.
--
-- 5) Verify THROUGH THE RUNTIME PATH (not a side psql):
--      node scripts/check-db-role.js   ->   expect:  cb_app / super=false / bypassrls=false   (RLS can now bite)
