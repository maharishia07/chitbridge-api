-- RUN-2026-10-20-11 · DB-80 · STEP 2 of 2: remove the last test-shop rows (after RUN-2026-10-20-10's dry run looked right)
-- DESTRUCTIVE: approved Athi 2026-10-20 ("remove as much as you can so we can get rid of test data which was generated")
-- Partial on error: each table's error is caught (rows = -1) and the rest still goes. Paste the result back.
SELECT what, lines, rows
  FROM (SELECT CASE WHEN what LIKE '%entity' THEN 'ENTITIES' ELSE detail END AS what, count(*) AS lines, sum(rows) AS rows
          FROM purge_test_entities(false)
         GROUP BY 1) s
 ORDER BY (what <> 'ENTITIES'), rows DESC;
