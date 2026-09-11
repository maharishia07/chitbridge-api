-- b221 · TEST RESULTS — SUMMARISE, THEN PURGE. NOT YET RUN.
-- ============================================================================================================
-- Athi, 2026-09-11: *"we need to have a mechanism of deleting the old results, otherwise it will keep growing."*
--
-- ⚠️⚠️ FIRST, THE ARITHMETIC, BECAUSE IT CHANGES THE URGENCY AND NOT THE ANSWER.
--
--     181 guard files × one run a day            ≈  66,000 rows a year
--     706 Playwright tests × a few runs a week   ≈ 100,000 rows a year
--     manual testing                                 hundreds
--                                                ─────────────────────
--                                                ≈ 200,000 rows a year
--
-- Postgres does not notice 200,000 rows, and will not notice two million. So this is NOT urgent — and it is
-- still worth deciding now, because "it grows" is the kind of thing that gets decided badly at 3 a.m. two years
-- from now by whoever is on call.
--
-- ── ⭐⭐⭐ WHY THE APP CANNOT SIMPLY DELETE ──────────────────────────────────────────────────────────────────
--
-- `test_result` is APPEND-ONLY BY GRANT (b219): cb_app may INSERT and SELECT and nothing else. That grant is the
-- entire reason the board can be believed — a status you can quietly edit is not a result, it is an opinion, and
-- a history you can quietly shorten is not a history.
--
-- ⚠️ So retention must NOT be done by loosening the grant. A DELETE right that exists "only for housekeeping" is
-- a DELETE right, and the next person to need one will find it already there. The purge is an OWNER operation,
-- run deliberately, exactly like every migration in this folder.
--
-- ── ⭐⭐ AND THE RULE IS: SUMMARISE BEFORE YOU DELETE ────────────────────────────────────────────────────────
--
-- Athi's own cold-archive doctrine: settled data moves hot → cold, and historical reads UNION the two. The METRIC
-- must survive even when the detail does not, because the metric is the thing anybody actually asks for — "how
-- many times did this run, how many times did it fail". Deleting rows without rolling them up first would throw
-- away the only answer while keeping the question.
--
-- ⚠️⚠️ AND TWO ROWS ARE NEVER DELETED, whatever the age:
--     · the LATEST result for a case — the board reads it; purging it blanks the row and reads as "never tested"
--     · anything belonging to a run that is still the newest run for its kind — a suite mid-retry would lose itself
--
-- Supabase -> SQL Editor -> paste -> Run. Step 1 only looks. Idempotent; safe to re-run.
-- ============================================================================================================

-- ── 1 · LOOK FIRST. How much is actually there, and how old?
SELECT count(*)                                        AS rows_now,
       count(DISTINCT case_key)                        AS cases_tracked,
       min(at)::date                                   AS oldest,
       max(at)::date                                   AS newest,
       count(*) FILTER (WHERE at < now() - interval '12 months') AS older_than_a_year
  FROM test_result;

-- ── 2 · THE ROLL-UP. One row per case per month, carrying the counts the metric is built from.
BEGIN;

CREATE TABLE IF NOT EXISTS test_result_month (
  entity_id   uuid NOT NULL,
  case_key    text NOT NULL,
  module_key  text,
  month       date NOT NULL,                 -- the first of the month
  run_kind    text NOT NULL,
  layer       text,
  runs        integer NOT NULL DEFAULT 0,
  passed      integer NOT NULL DEFAULT 0,
  failed      integer NOT NULL DEFAULT 0,
  blocked     integer NOT NULL DEFAULT 0,
  skipped     integer NOT NULL DEFAULT 0,
  -- ⚠️ FLIPS ARE CARRIED, NOT RECOMPUTED LATER. How many times consecutive runs disagreed is the ONLY number
  -- that separates "broken and stayed broken" from "cannot be believed", and it cannot be derived from counts
  -- once the individual rows are gone. Summing it across months is approximate at the boundary and that is
  -- honest: a flip between the last run of March and the first of April is not counted, and losing one flip in
  -- a month is not what this measure is for.
  flips       integer NOT NULL DEFAULT 0,
  first_at    timestamptz,
  last_at     timestamptz,
  PRIMARY KEY (entity_id, case_key, month, run_kind, COALESCE(layer, ''))
);

ALTER TABLE test_result_month ENABLE ROW LEVEL SECURITY;
ALTER TABLE test_result_month FORCE  ROW LEVEL SECURITY;

DROP POLICY IF EXISTS rls_entity ON test_result_month;
CREATE POLICY rls_entity ON test_result_month
  USING      (entity_id = NULLIF(current_setting('app.current_entity', true), '')::uuid)
  WITH CHECK (entity_id = NULLIF(current_setting('app.current_entity', true), '')::uuid);

-- ⭐ The app READS the summary and never writes it. The roll-up is an owner operation, like the purge it
-- precedes — so a summary cannot be quietly rewritten either.
GRANT SELECT ON test_result_month TO cb_app;
REVOKE INSERT, UPDATE, DELETE ON test_result_month FROM cb_app;

COMMIT;

-- ── 3 · ROLL UP everything older than the window. Re-runnable: it replaces the months it covers.
--        ⚠️ Run this BEFORE step 4, always. Step 4 refuses to delete a month that has not been summarised.
BEGIN;

WITH cutoff AS (SELECT (now() - interval '12 months') AS t),
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
ON CONFLICT (entity_id, case_key, month, run_kind, COALESCE(layer, '')) DO UPDATE
  SET runs = EXCLUDED.runs, passed = EXCLUDED.passed, failed = EXCLUDED.failed,
      blocked = EXCLUDED.blocked, skipped = EXCLUDED.skipped, flips = EXCLUDED.flips,
      first_at = EXCLUDED.first_at, last_at = EXCLUDED.last_at, module_key = EXCLUDED.module_key;

COMMIT;

-- ── 4 · THE PURGE. ⚠️ READ THE THREE GUARDS BEFORE RUNNING IT.
--
--   a · only rows older than the window
--   b · only where that (case, month, kind, layer) HAS been rolled up — no summary, no delete
--   c · NEVER the latest row for a case, at any age — the board reads it, and purging it blanks the row and
--       reads as "never tested", which is a lie the metric would then repeat
--
-- Run it as the OWNER. cb_app cannot execute this and that is deliberate.
BEGIN;

WITH keep_latest AS (
  SELECT DISTINCT ON (entity_id, case_key) result_id
    FROM test_result ORDER BY entity_id, case_key, at DESC
)
DELETE FROM test_result r
 WHERE r.at < (now() - interval '12 months')
   AND r.result_id NOT IN (SELECT result_id FROM keep_latest)
   AND EXISTS (
     SELECT 1 FROM test_result_month m
      WHERE m.entity_id = r.entity_id AND m.case_key = r.case_key
        AND m.month = date_trunc('month', r.at)::date
        AND m.run_kind = r.run_kind AND COALESCE(m.layer, '') = COALESCE(r.layer, ''));

COMMIT;

-- ── 5 · WHAT YOU SHOULD SEE
SELECT (SELECT count(*) FROM test_result)        AS detail_rows_left,
       (SELECT count(*) FROM test_result_month)  AS summary_rows,
       (SELECT min(at)::date FROM test_result)   AS oldest_detail,
       (SELECT min(month) FROM test_result_month) AS oldest_summary;
