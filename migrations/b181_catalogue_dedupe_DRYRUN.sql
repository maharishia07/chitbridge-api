-- b181 · DRY RUN — WHICH CATALOGUE ROWS ARE DUPLICATES, AND WHICH ONE SURVIVES
--
-- ⚠️ THIS FILE CHANGES NOTHING. It is a SELECT. Run it, read it, and only then run the _APPLY file.
--
-- WHY THERE ARE DUPLICATES AT ALL, stated plainly: `scripts/prove-usecases.js` creates its seven catalogue
-- items on every run and never checks whether they are already there. Athi, 2026-08-23: *"we just need only
-- three employees, why have you created so many"* — the same fault, and this is the catalogue half of it. The
-- proof is being made idempotent in the same change; this cleans up what it already made.
--
-- ⭐ WHAT "DELETE" MEANS HERE — the same thing the app means by it. `DELETE /api/products/:id` runs
--    `UPDATE catalogue_items SET is_active=false`, a soft delete. So this retires rows exactly as pressing
--    Delete on each one would: nothing is destroyed, and anything referencing an item_id still resolves.
--
-- ⭐ WHICH COPY SURVIVES: the OLDEST. It is the one that has been on the shelf longest, so it is the one any
--    older record is most likely to point at.
--
-- ⚠️ SCOPE: change the entity name below to whichever business you are cleaning. It is matched
--    case-insensitively against identities.display_name and NOTHING runs outside that one entity.

WITH target AS (
  SELECT identity_id
  FROM identities
  WHERE lower(display_name) = lower('Chola Auto Care')      -- ← the only place to edit
),
ranked AS (
  SELECT
    ci.item_id,
    ci.entity_id,
    ci.item_data->>'name'                                     AS product,
    ci.created_at,
    row_number() OVER (PARTITION BY ci.entity_id, lower(ci.item_data->>'name')
                       ORDER BY ci.created_at, ci.item_id)    AS copy_no,
    count(*)     OVER (PARTITION BY ci.entity_id, lower(ci.item_data->>'name'))
                                                              AS copies
  FROM catalogue_items ci
  JOIN target t ON t.identity_id = ci.entity_id
  WHERE ci.is_active = true
)
SELECT
  product,
  copies                                              AS copies_on_the_shelf,
  copies - 1                                          AS would_be_retired,
  min(created_at) FILTER (WHERE copy_no = 1)          AS survivor_added,
  max(item_id::text) FILTER (WHERE copy_no = 1)       AS survivor_item_id
FROM ranked
GROUP BY product, copies
ORDER BY copies DESC, product;
