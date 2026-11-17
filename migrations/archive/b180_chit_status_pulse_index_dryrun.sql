-- b180 · DRY RUN — should chit_status carry an index for the pulse watermark? Reads only; changes nothing.
--
-- Athi, 2026-08-22: "add an index on chit_status updated_at."
--
-- WHY IT WAS ASKED FOR. `GET /chits/pulse` (b-series, 2026-08-21) runs every 20 seconds per signed-in tab and
-- reads three watermarks. Two of them are index-only backward scans on existing indexes:
--     chit_header  MAX(created_at)   idx_chit_header_entity_created (entity_id, created_at)
--     state_log    MAX(created_at)   idx_state_log_entity           (entity_id, created_at)
-- The third has no such index. `MAX(updated_at) WHERE entity_id = $1` must therefore scan every one of that
-- entity's chit_status rows — fine at a few hundred, not fine at fifty thousand, and it is on a 20-second timer.
--
-- ⚠️⚠️ AN INDEX IS NOT FREE AND THIS TABLE IS THE WORST CASE FOR ONE. chit_status already carries TEN indexes,
-- and `updated_at` changes on EVERY write to the row — status advance, assign, read, star, snooze, archive,
-- delete. So this index is maintained on every write, not occasionally. The trade is deliberate: one extra
-- index write per status change against a full per-entity scan every 20 seconds per open tab.
--
-- Read the numbers below before running the apply. If `rows_per_entity_max` is small (a few hundred) the scan
-- is cheap and this index is not worth its write cost yet — that is a real possible answer, not a formality.

SELECT
  'size'                                                   AS report,
  (SELECT count(*) FROM chit_status)::text                 AS chit_status_rows,
  (SELECT count(DISTINCT entity_id) FROM chit_status)::text AS entities,
  (SELECT max(n)::text FROM (SELECT count(*) AS n FROM chit_status GROUP BY entity_id) q) AS rows_per_entity_max,
  (SELECT round(avg(n))::text FROM (SELECT count(*) AS n FROM chit_status GROUP BY entity_id) q) AS rows_per_entity_avg,
  ''                                                       AS detail

UNION ALL

-- what already exists, so an eleventh index is not added blind
SELECT 'index', indexname, '', '',
       pg_size_pretty(pg_relation_size((quote_ident(schemaname) || '.' || quote_ident(indexname))::regclass)),
       indexdef
FROM pg_indexes
WHERE tablename = 'chit_status'

UNION ALL

SELECT 'verdict',
  CASE WHEN EXISTS (SELECT 1 FROM pg_indexes WHERE tablename = 'chit_status' AND indexname = 'cs_entity_updated_idx')
       THEN 'already applied — nothing to do'
       ELSE 'not present — the apply script will create it CONCURRENTLY' END,
  '', '', '', ''

-- ⚠️ BY THE LABEL ONLY. The other columns are text here (a UNION needs one type per column), so ordering
-- by them would sort 9 after 10 and read as a data error rather than a formatting one.
ORDER BY report;
