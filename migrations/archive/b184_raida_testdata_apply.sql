-- ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════
-- b184 (APPLY) — remove the three register rows Claude wrote while verifying the roll-up.
-- ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════
--
-- ⚠️ RUN b184_raida_testdata_dryrun.sql FIRST and read what it lists. This one deletes.
--
-- Athi, 2026-08-30: *"clear the test entries"*. Written to prove Insight → Register: one open risk, and one
-- action closed so the report had both an Open and a Closed band to render.
--
-- ⚠️ ONE STATEMENT, because closes_id is a foreign key back to this table — an entry cannot go while the row
-- that closes it survives. Entries and closers are deleted together.
--
-- Safe to re-run: a second run deletes nothing and reports 0.

WITH targets AS (
  SELECT unnest(ARRAY[
    '62623abd-0aa0-4c2d-bfd1-12e54d0f9d9a',   -- risk   · "Compressor may be weak…"        open
    'ed1f53e1-fbb6-44cd-9f4e-1d78b0775c93'    -- action · "Order the o-ring before Thursday." closed
  ]::uuid[]) AS raida_id
),
gone AS (
  DELETE FROM chit_line_raida r
   WHERE r.raida_id IN (SELECT raida_id FROM targets)
      OR r.closes_id IN (SELECT raida_id FROM targets)
  RETURNING r.raida_id, r.closes_id
)
SELECT 'b184 applied' AS status,
       (SELECT count(*) FROM gone)                            AS rows_deleted,
       (SELECT count(*) FROM gone WHERE closes_id IS NULL)     AS entries_deleted,
       (SELECT count(*) FROM gone WHERE closes_id IS NOT NULL) AS closing_rows_deleted,
       (SELECT count(*) FROM chit_line_raida)                  AS register_rows_remaining;

-- EXPECTED on the first run: rows_deleted 3 · entries 2 · closing rows 1 · remaining 0.
-- ⚠️ `register_rows_remaining` counts the WHOLE table. If it is not 0, something has been recorded since — fine,
--    but say so, so the number is explained rather than assumed.
