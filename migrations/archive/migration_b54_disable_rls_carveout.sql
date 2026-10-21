-- migration_b54_disable_rls_carveout.sql — B1 RLS: enforce RLS ONLY on the 6 Direct tables; carve-out/stage-2 OFF.
--
-- Context (2026-07-04, discovered at cutover): Supabase had **blanket-enabled** RLS on EVERY table in `public`,
-- but only the 6 Direct tables (b49) have policies. Under the `cb_app` role that made every OTHER table deny-all
-- (0 rows), which silently broke any feature reading them: the recipient search (`identities`), messaging
-- (`chit_messages`), disputes (`chit_disputes`), connections, suppliers, actor settings, SCHEMAS (`entity_schemas`
-- / `schema_fields` — including the `catalogue_items` visibility sub-select), governance, and the dormant
-- `cb_*` / `sim_*` tables.
--
-- Fix: disable RLS on every table WITHOUT a policy, restoring them to app-layer scoping exactly as before the
-- cutover. Only the 6 Direct tables (each with the `rls_entity` policy) stay enforced. Idempotent + safe: it only
-- touches tables that have 0 policies, so the enforced 6 are never affected. On a fresh install where RLS was
-- never blanket-enabled, this is a no-op. Run as postgres (owner). See scripts/rls-readiness-check.sql to verify.
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT c.relname
      FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public' AND c.relkind = 'r' AND c.relrowsecurity
       AND (SELECT count(*) FROM pg_policies p WHERE p.tablename = c.relname) = 0
  LOOP
    EXECUTE format('ALTER TABLE public.%I DISABLE ROW LEVEL SECURITY', r.relname);
    RAISE NOTICE 'RLS disabled on %', r.relname;
  END LOOP;
END $$;
