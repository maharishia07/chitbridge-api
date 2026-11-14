-- READ-2026-10-28-1-chit-set-status-all-callers.sql · RAIL-130 (a) · READ-ONLY · paste the result back before b798 is considered.
--
-- WHAT IT ASKS: is the database function chit_set_status_all(uuid, text) still reachable in production, and has anything called it?
--    The rail has ONE status writer (lib/rail-status.js statusGate, guarded by tests/rail-status.test.cjs). This SECURITY DEFINER function sets
--    EVERY copy's chit_status.current_status for a chit, bypassing that table of steps. At api 7b68cfad nothing in lib/, routes/, middleware/,
--    tests/ or the web calls it, and the one-writer scanner reads JS only, so it cannot see it (status card, docs/01-rail-core-the-chit).
-- ROWS: 1 the function and its body hash · 2 whether call counting is on (track_functions) · 3 the calls counted since the last stats reset ·
--    4 other functions whose body names it · 5 objects that depend on it (views, triggers, policies).
--    Rows 3-5 empty and row 1 present = nothing reaches it; then b798 is Athi's yes or no. Touches nothing.

SELECT 1 AS ord, 'function' AS check_name,
       COALESCE((SELECT p.oid::regprocedure::text || ' · secdef=' || p.prosecdef || ' · md5=' || left(md5(p.prosrc), 12)
                   FROM pg_proc p WHERE p.proname = 'chit_set_status_all'), '(not found: b798 is not needed)') AS finding
UNION ALL
SELECT 2, 'track_functions', current_setting('track_functions')
UNION ALL
SELECT 3, 'calls since stats reset', COALESCE((SELECT s.calls::text || ' (last reset ' || COALESCE(d.stats_reset::text, 'never') || ')'
                   FROM pg_stat_user_functions s CROSS JOIN pg_stat_database d
                  WHERE s.funcname = 'chit_set_status_all' AND d.datname = current_database()), '(no row: 0 calls, or track_functions is none)')
UNION ALL
SELECT 4, 'named in another function', COALESCE((SELECT string_agg(p.oid::regprocedure::text, ', ')
                   FROM pg_proc p WHERE p.prosrc ILIKE '%chit_set_status_all%' AND p.proname <> 'chit_set_status_all'), '(none)')
UNION ALL
SELECT 5, 'depends on it', COALESCE((SELECT string_agg(d.classid::regclass::text || ':' || d.objid::text, ', ')
                   FROM pg_depend d JOIN pg_proc p ON d.refobjid = p.oid
                  WHERE p.proname = 'chit_set_status_all' AND d.deptype = 'n'), '(none)')
ORDER BY ord;
