-- b798_drop_chit_set_status_all.sql — RAIL-130 (a) (28 Oct 2026): drop the second status writer that lives in SQL.
--
-- ⚠️⚠️ DRAFT — NOT RUN · PROPOSAL ONLY · Athi decides and runs it (Supabase SQL editor, AS postgres), and ONLY after
--    READ-2026-10-28-1-chit-set-status-all-callers.sql is pasted back with rows 3-5 empty (no calls counted, no function names it, nothing depends on it).
--    Safe to re-run (IF EXISTS). Touches no rows.
--
-- WHY. The rail has ONE status writer: lib/rail-status.js statusGate asks the rail's table of steps (lib/rail.js TRANSITIONS), and
--    tests/rail-status.test.cjs guards that nothing else writes chit_status.current_status. chit_set_status_all(uuid, text) (baseline lines 891-903,
--    b50 in migrations/archive/) is SECURITY DEFINER and sets EVERY copy's status for a chit the caller sent, with no table of steps. No code calls it
--    at api 7b68cfad, and the guard reads JS only, so a future caller would go unseen. Removing it leaves the one writer as the only door.
-- RESTRICT (the default): the DROP fails, and nothing changes, if any object still depends on the function.
-- UNDO. Re-create it from migrations/000_baseline_2026-10-21.sql lines 891-903 and its grants (lines 10431-10432: REVOKE ALL FROM PUBLIC; GRANT ALL TO cb_app).
-- AFTER IT RUNS: drop 'chit_set_status_all' from the fns list of scripts/rls-readiness-check.sql (this PR already does), add a MIGRATIONS-LOG.md row,
--    and `node tools/migrate.cjs --db <prod> --record migrations/b798_drop_chit_set_status_all.sql`.

BEGIN;
DROP FUNCTION IF EXISTS public.chit_set_status_all(uuid, text);
COMMIT;
