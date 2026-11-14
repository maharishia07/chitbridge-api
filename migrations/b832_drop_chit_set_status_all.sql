-- b832_drop_chit_set_status_all.sql — RAIL-130 (a) (4 Nov 2026, Athi: "RAIL-130a yes, draft the SQL").
--
-- ⚠️⚠️ DRAFT — NOT RUN IN PRODUCTION · Athi runs it (Supabase SQL editor, AS postgres), then
--    node tools/migrate.cjs --db <prod> --record b832_drop_chit_set_status_all.sql  and a MIGRATIONS-LOG.md row.
--    Safe to re-run (DROP FUNCTION IF EXISTS). Touches no rows, no table, no policy.
--
-- WHY. public.chit_set_status_all(uuid, text) (000_baseline_2026-10-21.sql:891-903, from archive/migration_b50) sets EVERY copy's
--   current_status in one statement. That is a SECOND status writer beside the rail's one writer (lib/rail-status.js, card
--   01-rail-core-the-chit/functions/status-the-one-status-writer.md), and it bypasses the rail's event table. It has NO caller:
--   `git grep chit_set_status_all -- '*.js' '*.cjs' '*.mjs' ':!migrations'` on api main bd6c6fee = 0 lines (lib/, routes/, middleware/,
--   tests/, tools/, scripts/). The one-writer scanner (tests/rail-status.test.cjs) reads JS only, so a SQL writer is invisible to it:
--   removing the function removes the only way around the rule.
-- BEFORE YOU RUN (production, read-only): confirm nothing outside this repo calls it in the last days.
--   SELECT calls FROM pg_stat_user_functions WHERE funcname = 'chit_set_status_all';   -- needs track_functions; NULL/0 or no row = unused
--   SELECT p.oid::regprocedure FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
--    WHERE n.nspname = 'public' AND p.proname = 'chit_set_status_all';                 -- expect 1 row before, 0 after
-- ROLLBACK: the body is in 000_baseline_2026-10-21.sql:891-903 and its grant at :10431-10432; re-create from there if ever needed.
-- KEPT: chit_set_customer_priority_all, chit_log_all and the other *_all functions are not touched (not in RAIL-130).
-- OWNER: cb-rail (the one status writer) · cb-db (this file)

BEGIN;

DROP FUNCTION IF EXISTS public.chit_set_status_all(p_chit_id uuid, p_new_status text);

COMMIT;
