-- RUN-2026-10-20-8 · DB-80 · REMOVE the e2e test shops (3,125 in the dry run of 20 Oct) and every row they own
-- DESTRUCTIVE: approved Athi 2026-10-20 ("remove as much as you can so we can get rid of test data which was generated")
-- BEFORE YOU RUN: engines → Actions → backup-nightly → one run GREEN today (DB-54 checkpoint). No green backup = do not run.
-- Same function and pattern as the dry run READ-2026-10-20-6 (email @test.example / @test-cb.com, e2eco-… / e2e.pool… / E2E Pool…);
-- no real shop matches it. ⚠️ NOT all-or-nothing: the function catches each table's error (rows = -1 in the result) and keeps going,
-- so every table that did not refuse IS cleared (20 Oct run: identities refused on identities_parent_entity_id_fkey, books_change_log on
-- its P0001 trigger; everything else went).
-- The space is NOT given back yet: run RUN-2026-10-20-9 (VACUUM FULL) next.
-- PASTE THE RESULT BACK: the same shape as the dry run; the numbers should match it (a few more if tests ran since).
SELECT what, lines, rows
  FROM (SELECT CASE WHEN what LIKE '%entity' THEN 'ENTITIES' ELSE detail END AS what, count(*) AS lines, sum(rows) AS rows
          FROM purge_test_entities(false)
         GROUP BY 1) s
 ORDER BY (what <> 'ENTITIES'), rows DESC;
