-- tools/seed/seed-e-stamp.sql — SEED E recorded_at stamp (F4): sets journal_entry.created_at on DEMO clients' entries to their own posting day, plus a fixed set of true exceptions.
-- Run only by tools/seed/seed-e.cjs (stampRecorded, or --stamp-sql for psql) AS THE DATABASE OWNER with the insert-only trigger stood aside for one transaction, demo clients only.
-- It is a .sql file on purpose: the application never updates the journal (tests/books-writer.test.cjs), and lib/books-store.js, the one writer, must never UPDATE it. Placeholders: the ids, the FY dates and the zone, filled by seed-e.
WITH j AS (
  SELECT e.entry_id, e.entity_id, e.posting_date, e.created_at,
         row_number() OVER (PARTITION BY e.entity_id, e.posting_date ORDER BY (e.reverses_entry_id IS NOT NULL), e.entry_no) AS rn_day /* a reversal after its original, whatever the series sorts to */,
         (e.posting_date BETWEEN '%FY_FROM%' AND '%FY_TO%' AND e.reverses_entry_id IS NULL
          AND NOT EXISTS (SELECT 1 FROM journal_entry r WHERE r.entity_id = e.entity_id AND r.reverses_entry_id = e.entry_id)) AS plain_fy
    FROM journal_entry e WHERE e.entity_id = ANY(%IDS%)),
k AS (
  SELECT j.*, CASE WHEN plain_fy THEN row_number() OVER (PARTITION BY entity_id, plain_fy ORDER BY posting_date, entry_id) END AS k,
         count(*) FILTER (WHERE plain_fy) OVER (PARTITION BY entity_id) AS c
    FROM j),
s AS (
  SELECT k.*, CASE WHEN k > c - 3 THEN 9 WHEN k = 150 THEN 12 WHEN k = 300 THEN 20 ELSE 0 END AS late_days,
         CASE k WHEN 90 THEN interval '21 hours 40 minutes' WHEN 210 THEN interval '6 hours 20 minutes' WHEN 350 THEN interval '22 hours 5 minutes' WHEN 440 THEN interval '5 hours 45 minutes' END AS night_at
    FROM k),
d AS (
  SELECT s.*, (posting_date + late_days) + CASE extract(isodow FROM posting_date + late_days) WHEN 6 THEN 2 WHEN 7 THEN 1 ELSE 0 END AS day_at FROM s)
UPDATE journal_entry u
   SET created_at = LEAST(now(), (d.day_at::timestamp + COALESCE(d.night_at, CASE WHEN d.late_days > 0 THEN interval '11 hours' ELSE interval '9 hours' + LEAST(d.rn_day - 1, 20) * interval '17 minutes' END)) AT TIME ZONE '%TZ%')
  FROM d WHERE u.entry_id = d.entry_id;
