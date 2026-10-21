-- RUN-2026-10-21-5-test-result-summarise.sql · DB-8 (b221 v2, step 3 of 5) · MONTHLY ROUTINE, Athi runs it (SQL editor, AS postgres)
-- Summarise test_result months older than 12 months into test_result_month (adds summary rows only, deletes nothing). Run BEFORE
-- RUN-2026-10-21-6 every month. Whole months only; ON CONFLICT DO NOTHING so a month already summarised is never rebuilt from what a
-- purge left behind (the b221 v1 bug: DO UPDATE after a purge took runs 40 → 1, proven locally 18 Oct). Re-running is a no-op.
-- Before Sep 2027 there is nothing older than 12 months (test_result starts Sep 2026): it adds 0 rows. Steps 1–2 were run 18 Oct
-- (test_result_month is in the 21 Oct baseline). Source: C:/dev/sql-to-run/2026-10-18/b221-3-summarise.sql (now marked SUPERSEDED).
-- RLS: test_result_month is FORCE RLS; the roll-up is an owner operation (cb_app holds SELECT only).
BEGIN;

WITH cutoff AS (SELECT date_trunc('month', now() - interval '12 months') AS t),   -- RETENTION
ordered AS (
  SELECT r.*, lag(status) OVER (PARTITION BY entity_id, case_key ORDER BY at) AS prev
    FROM test_result r WHERE at < (SELECT t FROM cutoff)
),
rolled AS (
  SELECT entity_id, case_key, max(module_key) AS module_key,
         date_trunc('month', at)::date AS month, run_kind, layer,
         count(*)                                  AS runs,
         count(*) FILTER (WHERE status = 'pass')    AS passed,
         count(*) FILTER (WHERE status = 'fail')    AS failed,
         count(*) FILTER (WHERE status = 'blocked') AS blocked,
         count(*) FILTER (WHERE status = 'skipped') AS skipped,
         count(*) FILTER (WHERE prev IS NOT NULL AND prev <> status) AS flips,
         min(at) AS first_at, max(at) AS last_at
    FROM ordered
   GROUP BY entity_id, case_key, date_trunc('month', at), run_kind, layer
)
INSERT INTO test_result_month (entity_id, case_key, module_key, month, run_kind, layer,
                               runs, passed, failed, blocked, skipped, flips, first_at, last_at)
SELECT entity_id, case_key, module_key, month, run_kind, layer,
       runs, passed, failed, blocked, skipped, flips, first_at, last_at
  FROM rolled
ON CONFLICT (entity_id, case_key, month, run_kind, COALESCE(layer, '')) DO NOTHING;   -- a summarised month is never rebuilt from what a purge left

COMMIT;
SELECT count(*) AS summary_rows FROM test_result_month;
