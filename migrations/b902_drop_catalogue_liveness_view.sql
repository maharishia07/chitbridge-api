-- b902_drop_catalogue_liveness_view.sql — drop public.cb_catalogue_liveness (VERIFY-GF-DB F3, batch 1128).
--
-- ⚠️ NOT RUN anywhere · Athi runs it (Supabase SQL editor, AS postgres), SIT first. Safe to repeat (DROP VIEW IF EXISTS).
-- WHY  the view has no security_invoker and cb_app holds SELECT,INSERT,DELETE,UPDATE on it (baseline: GRANT ... TO cb_app). It is one table with no top-level
--      aggregate, so Postgres treats it as auto-updatable: a DELETE/UPDATE through it runs with the OWNER's rights, and an owner with BYPASSRLS skips the
--      entity policy on catalogue_items. No route, lib, src or tool reads it (git grep: 0 callers). Nothing else depends on it (a plain DROP, no CASCADE, would refuse otherwise).
-- RLS: touches no table, no policy, no grant on a table. cb_backup loses its SELECT on the view with the view.
-- ORDER either order is safe: nothing reads the view.
-- ROLL BACK: recreate the view from migrations/000_baseline_2026-10-21.sql (CREATE VIEW public.cb_catalogue_liveness, about line 2266) and, only if a reader appears,
--      WITH (security_invoker = true) and GRANT SELECT (never DML) TO cb_app, cb_backup.
-- CHECK (read-only): SELECT to_regclass('public.cb_catalogue_liveness');   (NULL)
BEGIN;
SET LOCAL lock_timeout = '5s';
DROP VIEW IF EXISTS public.cb_catalogue_liveness;
COMMIT;
