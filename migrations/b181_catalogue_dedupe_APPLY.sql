-- b181 · APPLY — retire every duplicate catalogue row except the oldest of each name
--
-- ⚠️ RUN THE _DRYRUN FILE FIRST AND READ IT. This one writes.
--
-- ⭐ It is a SOFT delete — `is_active=false`, exactly what pressing Delete on each product does
--    (`DELETE /api/products/:id` → `UPDATE catalogue_items SET is_active=false`). Nothing is destroyed, so
--    every `reference` on a recorded line event still resolves, and an accidental over-match is reversible:
--
--        UPDATE catalogue_items SET is_active = true WHERE item_id IN ( … the ids this returns … );
--
-- ⚠️ ONE entity, named below, and the same name the dry run used. Change both or neither.
-- ⚠️ Idempotent: run it twice and the second run reports zero rows, because the survivors are no longer duplicates.

WITH target AS (
  SELECT identity_id
  FROM identities
  WHERE lower(display_name) = lower('Chola Auto Care')      -- ← must match the dry run
),
ranked AS (
  SELECT
    ci.item_id,
    row_number() OVER (PARTITION BY ci.entity_id, lower(ci.item_data->>'name')
                       ORDER BY ci.created_at, ci.item_id) AS copy_no
  FROM catalogue_items ci
  JOIN target t ON t.identity_id = ci.entity_id
  WHERE ci.is_active = true
),
retired AS (
  UPDATE catalogue_items c
     SET is_active = false
    FROM ranked r
   WHERE c.item_id = r.item_id
     AND r.copy_no > 1                                       -- keep copy 1, retire the rest
  RETURNING c.item_id, c.item_data->>'name' AS product
)
SELECT product, count(*) AS retired
FROM retired
GROUP BY product
ORDER BY product;
