-- b194b APPLY · WRITES. Align entity_schemas.visibility with the publish act the owner already made.
--
-- ⚠️⚠️ READ b194_schema_visibility_backfill_dryrun.sql FIRST AND READ ITS SECTION 2. This relaxes visibility on
-- live rows: 11 shops gain visible products, ~98 gain nothing today. The dry run names all 11. If you have not
-- looked at that list, close this file.
--
-- ⚠️ THIS FILE ENDS IN ROLLBACK. Run it, read the result, and only then change the last line to COMMIT and run
-- it again. That is the standing rule for anything destructive or exposing, and publishing is exposing.
--
-- ⭐ THE GUARD IS ON THE SHAPE, AND ITS NUMBER IS ON SCREEN. b193 measured 129 affected of 182 public shops on
-- 2026-09-01, ~109 of them with an active default schema. If the count has moved by more than the tolerance
-- below, the data is not what was approved and this aborts rather than writing to a shape nobody reviewed.
-- The count it guards on is SELECTed too — a guard whose input cannot be seen is not a guard.

BEGIN;

-- What is about to change, visible before the write.
CREATE TEMP TABLE b194_target ON COMMIT DROP AS
SELECT es.schema_id, i.bridge_id, COALESCE(i.display_name, i.bridge_id) AS shop,
       (SELECT count(*) FROM catalogue_items ci
         WHERE ci.entity_id = i.identity_id AND ci.is_active = true) AS own_items
  FROM identities i
  JOIN entity_schemas es
    ON es.entity_id = i.identity_id AND es.status = 'active' AND es.is_default = true
 WHERE i.identity_type = 'entity'
   AND i.catalogue_visibility = 'public'
   AND es.visibility IS DISTINCT FROM 'public';

DO $$
DECLARE
  n int;
BEGIN
  SELECT count(*) INTO n FROM b194_target;
  -- Approved shape: ~109. A wide band, because ordinary use moves this a little; a big move means something else.
  IF n < 60 OR n > 160 THEN
    RAISE EXCEPTION 'b194 aborted — % schemas match, approved shape was about 109. Re-run b193 and look again.', n;
  END IF;
END $$;

UPDATE entity_schemas es
   SET visibility = 'public'
  FROM b194_target t
 WHERE es.schema_id = t.schema_id;

-- ONE result set: what changed, with the shops that gained products named.
SELECT 1 AS ord, 'CHANGED' AS section,
       count(*)::text                                   AS schemas,
       count(*) FILTER (WHERE own_items > 0)::text      AS shops_gaining_products,
       COALESCE(sum(own_items), 0)::text                AS products_now_visible,
       ''                                               AS bridge_id,
       ''                                               AS shop
  FROM b194_target
UNION ALL
SELECT 2, 'GAINED PRODUCTS', own_items::text, '', '', bridge_id, shop
  FROM b194_target WHERE own_items > 0
 ORDER BY 1, 3 DESC, 6;

-- ⚠️ Change to COMMIT and re-run once the result above is what you expect.
ROLLBACK;

-- ── AFTER COMMITTING ─────────────────────────────────────────────────────────────────────────────────────────
-- Re-run b193. It should report affected_with_products = 0, and every remaining "affected" row should be a shop
-- with no active schema at all — which is correct and needs nothing.
--
-- Then open alpha timers' storefront: all 16 own products alongside the adopted catalogue, which is the whole
-- point of the exercise.
--
-- Rollback, if a shop turns out not to have wanted this: set its catalogue_visibility to 'private' in the app.
-- PATCH /profile now mirrors both flags, so the single control does the whole job — that is what was broken.
