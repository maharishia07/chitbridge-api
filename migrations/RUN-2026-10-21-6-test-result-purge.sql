-- RUN-2026-10-21-6-test-result-purge.sql · DB-8 (b221 v2, step 4 of 5) · MONTHLY ROUTINE, Athi runs it (SQL editor, AS postgres), AFTER -5
-- Deletes test_result detail rows older than 12 whole months that ARE summarised in test_result_month; always keeps the latest row per
-- check and the newest run of each kind. A row whose month has no summary is never deleted. Then READ-2026-10-21-5 to see the result.
-- ⚠️ A DELETE frees no Supabase quota until VACUUM FULL (RUN-2026-10-20-9, alone, not in a transaction).
-- Source: C:/dev/sql-to-run/2026-10-18/b221-4-purge.sql (now marked SUPERSEDED).
-- RLS: test_result is FORCE RLS; as postgres (owner policy / bypass) — never as cb_app.
BEGIN;

WITH keep_latest AS (
  SELECT DISTINCT ON (entity_id, case_key) result_id
    FROM test_result ORDER BY entity_id, case_key, at DESC
), keep_run AS (   -- d · the newest run of each kind stays whole (a suite mid-retry keeps itself)
  SELECT DISTINCT ON (entity_id, run_kind) run_id
    FROM test_result ORDER BY entity_id, run_kind, at DESC
)
DELETE FROM test_result r
 WHERE r.at < date_trunc('month', now() - interval '12 months')   -- RETENTION
   AND r.result_id NOT IN (SELECT result_id FROM keep_latest)
   AND r.run_id NOT IN (SELECT run_id FROM keep_run)
   AND EXISTS (
     SELECT 1 FROM test_result_month m
      WHERE m.entity_id = r.entity_id AND m.case_key = r.case_key
        AND m.month = date_trunc('month', r.at)::date
        AND m.run_kind = r.run_kind AND COALESCE(m.layer, '') = COALESCE(r.layer, ''));

COMMIT;
SELECT count(*) AS detail_rows_left FROM test_result;
