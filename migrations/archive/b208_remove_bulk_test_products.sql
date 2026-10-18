-- b208 · EMPTY tallytest's CATALOGUE SO IT CAN BE RE-SEEDED FRESH
-- ===========================================================================
-- Athi, 2026-09-08: "remove all the rows and update as a fresh one".
--
-- WHY. A scale test seeded 10,000 synthetic products into this shop that day to
-- measure the catalogue and the counter under load. They were never removed, so
-- the shop holds 10,006 products of which 6 are real, and the counter opens on
-- a shelf of "Idhayam Wheat single · BULK-009600" instead of its own stock.
--
-- WHY YOU RUN IT, NOT ME. A connector key can PATCH one product at a time and
-- there is no bulk delete — 10,000 round trips from outside. This is one
-- statement. Deleting rows is your call, not mine.
--
-- AFTER THIS, tell me and I load the fresh 41-product catalogue through the
-- connector key (tools/seed/tallytest-catalogue.json): real units, HSN codes,
-- GST slabs across 0/5/12/18/28, 13 categories, barcodes to scan, and Tamil
-- words on 29 of them so the counter's search can be tried properly.
--
-- Supabase → SQL Editor → paste → Run.
-- ===========================================================================

-- ── 1 · LOOK FIRST. Expect total ≈ 10006.
SELECT count(*) AS total_now
FROM catalogue_items
WHERE entity_id = 'c2837d52-47f2-47e2-9fcd-b98c68a49e45';

-- ── 2 · EMPTY IT. Run this block on its own; it shows the count before commit.
BEGIN;

WITH gone AS (
  DELETE FROM catalogue_items
   WHERE entity_id = 'c2837d52-47f2-47e2-9fcd-b98c68a49e45'
  RETURNING 1
)
SELECT count(*) AS deleted FROM gone;

-- ⚠️ Read the number. ~10006 → COMMIT;   anything unexpected → ROLLBACK;
COMMIT;

-- ── 3 · PROVE IT. Expect 0.
SELECT count(*) AS remaining
FROM catalogue_items
WHERE entity_id = 'c2837d52-47f2-47e2-9fcd-b98c68a49e45';
