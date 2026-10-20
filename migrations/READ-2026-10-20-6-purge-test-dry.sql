-- READ-2026-10-20-6 · DB-80 · how much the existing test purge WOULD remove (dry run: deletes nothing)
-- Uses the function already on production: purge_test_entities(dry => true). A test entity = an e2e-minted one, by pattern only
-- (email @test.example / @test-cb.com, user_id or name e2eco-… / e2e.pool… / E2E Pool…); see purge_test_entities_ROUTINE.sql.
-- ⚠️ Do NOT run purge_test_entities_ROUTINE.sql: that file APPLIES the purge. This one only counts.
-- Paste the whole result back (one row per table, entities summed into the first row).
SELECT what, lines, rows
  FROM (SELECT CASE WHEN what LIKE '%entity' THEN 'ENTITIES' ELSE detail END AS what, count(*) AS lines, sum(rows) AS rows
          FROM purge_test_entities(true)
         GROUP BY 1) s
 ORDER BY (what <> 'ENTITIES'), rows DESC;
