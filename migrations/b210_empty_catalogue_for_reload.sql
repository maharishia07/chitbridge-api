-- b210 · EMPTY THE CATALOGUE AGAIN, SO IT CAN BE RELOADED WITH SANE PRICES
-- ===========================================================================
-- Athi, 2026-09-09, after seeing a 5 kg bag of rice priced at Rs 2,400: "fix the issue".
--
-- WHY. My price generator treated each category band as "what this category costs" and clamped to it, so large packs piled up
-- ON the ceiling: 804 of 1,279 rice products priced identically at Rs 2,400, 145 of 558 oils, 107 of 650 pulses. A whole
-- category sharing one price is not scale data, it is one row repeated. The band is now a price PER UNIT which the pack size
-- multiplies, so 1,346 distinct prices replace the pile-up and a 25 kg bag reads Rs 1,659.
--
-- WHY YOU RUN IT, NOT ME. A connector key can PATCH one product at a time and
-- there is no bulk delete — 10,000 round trips from outside. This is one
-- statement. Deleting rows is your call, not mine.
--
-- AFTER THIS, say the word and I reload 10,441 products with the corrected prices. Your five OFFERS are untouched by this —
-- they are definitions, not catalogue rows, and they target CATEGORIES, so they attach themselves to the new products the
-- moment they land. Nothing else needs setting up again.
--
-- ⭐ WITH RLS. catalogue_items is row-level-secured; the context is set below so the delete can only ever touch THIS shop —
-- if the id were wrong the statement would remove nothing rather than empty somebody else. Supabase → SQL Editor → paste → Run.
-- ===========================================================================

SELECT set_config('app.current_entity', 'c2837d52-47f2-47e2-9fcd-b98c68a49e45', false);

-- ── 1 · LOOK FIRST. Expect total = 10441.
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

-- ⚠️ Read the number. ~10441 → COMMIT;   anything unexpected → ROLLBACK;
COMMIT;

-- ── 3 · PROVE IT. Expect 0.
SELECT count(*) AS remaining
FROM catalogue_items
WHERE entity_id = 'c2837d52-47f2-47e2-9fcd-b98c68a49e45';
