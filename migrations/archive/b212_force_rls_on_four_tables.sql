-- b212 · FORCE ROW LEVEL SECURITY ON FOUR HALF-PROTECTED TABLES
-- ============================================================================================================
-- Found by tests/engine-boundary.test.js, running the offline guard set on 2026-09-09:
--
--   "ENABLE without FORCE means the TABLE OWNER still reads every row. Half-protected:
--    register_attachable, chit_reads, retention_config, catalogue_item_schedule"
--
-- WHAT THE DIFFERENCE ACTUALLY IS.
--   ENABLE ROW LEVEL SECURITY   the policies apply to ordinary roles
--   FORCE  ROW LEVEL SECURITY   the policies apply to the TABLE OWNER as well
-- Postgres exempts a table's owner from its own policies unless FORCE is set. Every other RLS table in this
-- schema sets both (b160 does it explicitly for definition and definition_version); these four set only ENABLE.
--
-- ⚠️ IS IT EXPLOITABLE TODAY? Almost certainly not: the application connects as cb_app, which is NOT the owner,
-- so the policies already bind every query the product makes. This is the gap between "safe because of how we
-- happen to connect" and "safe because the table says so" — and the second is the one that survives somebody
-- running a migration, a backfill or a psql session as the owner. Which is exactly how a leak starts.
--
-- ⚠️ WHAT IT COULD BREAK. Any job that RELIES on being the owner to see across entities. If a backfill or a
-- report reads one of these four tables without setting app.current_entity, it will start returning nothing —
-- silently, because RLS filters rather than errors. Run step 1 first: it lists what policies exist, so you can
-- see what each table will start enforcing.
--
-- ⭐ WITH RLS, obviously — that is the entire subject. Supabase -> SQL Editor -> paste -> Run.
-- ============================================================================================================

-- ── 1 · LOOK FIRST. What is the state now, and what policy will start applying to the owner?
SELECT c.relname AS table_name,
       c.relrowsecurity  AS enabled,
       c.relforcerowsecurity AS forced,
       (SELECT count(*) FROM pg_policy p WHERE p.polrelid = c.oid) AS policies
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public'
  AND c.relname IN ('register_attachable', 'chit_reads', 'retention_config', 'catalogue_item_schedule')
ORDER BY c.relname;

-- ⚠️ If any row shows policies = 0, STOP. Forcing RLS on a table with no policy denies EVERYONE, including the
--    application — that is an outage, not a hardening. Tell me and I will write the missing policy first.

-- ── 2 · FORCE THEM. Four statements, each independent; run the block and read the notice.
BEGIN;

ALTER TABLE register_attachable      FORCE ROW LEVEL SECURITY;
ALTER TABLE chit_reads               FORCE ROW LEVEL SECURITY;
ALTER TABLE retention_config         FORCE ROW LEVEL SECURITY;
ALTER TABLE catalogue_item_schedule  FORCE ROW LEVEL SECURITY;

DO $$
BEGIN
  RAISE NOTICE 'b212: four tables now FORCE row level security — the owner obeys the policy like everybody else.';
  RAISE NOTICE 'b212: if a backfill or a report goes quiet on one of these, it was relying on owner bypass. Set';
  RAISE NOTICE 'b212: app.current_entity in that job rather than undoing this.';
END $$;

COMMIT;

-- ── 3 · PROVE IT. Expect forced = true on all four.
SELECT c.relname AS table_name, c.relrowsecurity AS enabled, c.relforcerowsecurity AS forced
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public'
  AND c.relname IN ('register_attachable', 'chit_reads', 'retention_config', 'catalogue_item_schedule')
ORDER BY c.relname;

-- ── AFTERWARDS: tests/engine-boundary.test.js stops reporting half-protected tables, and it will catch the next
--    one on the day it is added rather than whenever somebody next runs the guards by hand.
