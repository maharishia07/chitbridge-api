-- money-1-inspect.sql — READ ONLY. Changes nothing. Run this first and read every number before going near step 2.
--
-- Purpose: find every bare-number price, and — more importantly — find the rows that CANNOT be stamped safely.
-- A stamp is irreversible in meaning: once a price says INR, nobody can later tell whether that was declared or
-- guessed. So the job of this file is to surface the guesses BEFORE they are baked in.
--
-- Requires a role that can bypass RLS on catalogue_items (ADMIN_DATABASE_URL / the owner role). Under the app role
-- these counts will come back low or zero, which is itself a signal you are on the wrong connection.

\echo '=== A · what shape are catalogue_items prices in today? ==='
SELECT
  jsonb_typeof(item_data->'price')            AS price_shape,
  count(*)                                    AS rows,
  count(*) FILTER (WHERE is_active)           AS active_rows
FROM catalogue_items
GROUP BY 1 ORDER BY 2 DESC;
-- 'number'  → legacy, to be stamped
-- 'object'  → already stamped (step 3 skips these, so re-running is safe)
-- 'null' / NULL → price on request. NOT an error, and NOT to be stamped as zero.
-- 'string'  → ⚠ investigate before proceeding; a price stored as text is a separate defect

\echo ''
\echo '=== B · BLOCKERS: rows whose owning entity has no usable currency ==='
-- These CANNOT be stamped. There is nothing to stamp them WITH, and inventing one is the bug we are fixing.
SELECT
  i.identity_id,
  i.display_name,
  i.currency_code                             AS bad_currency,
  count(ci.item_id)                           AS priced_items
FROM catalogue_items ci
JOIN identities i ON i.identity_id = ci.entity_id
WHERE jsonb_typeof(ci.item_data->'price') = 'number'
  AND (i.currency_code IS NULL OR i.currency_code !~ '^[A-Z]{3}$')
GROUP BY 1,2,3 ORDER BY 4 DESC;
-- EXPECT ZERO ROWS. If any appear, step 3 will refuse to run until each entity has a valid currency_code.

\echo ''
\echo '=== C · the stamp that will be applied, per entity ==='
SELECT
  i.display_name,
  i.currency_code                             AS will_stamp_as,
  i.country,
  count(*)                                    AS items_to_stamp,
  min((ci.item_data->>'price')::numeric)      AS min_price,
  max((ci.item_data->>'price')::numeric)      AS max_price
FROM catalogue_items ci
JOIN identities i ON i.identity_id = ci.entity_id
WHERE jsonb_typeof(ci.item_data->'price') = 'number'
GROUP BY 1,2,3 ORDER BY 4 DESC;
-- READ THIS ROW BY ROW. `will_stamp_as` is an ASSUMPTION: that the entity's currency today is the one its prices
-- were written in. For an entity that has never changed currency this is safe. For one that has, it is WRONG and
-- unrecoverable. If you cannot vouch for a row, exclude that entity in step 3 rather than guessing.

\echo ''
\echo '=== D · does any entity look like it trades in more than one currency? ==='
-- A single entity whose catalogue prices span wildly different magnitudes may hold mixed-currency prices already.
-- This is a heuristic, not proof — it exists to make you look, not to decide for you.
SELECT
  i.display_name, i.currency_code,
  count(*)                                                        AS items,
  round(max((ci.item_data->>'price')::numeric)
      / NULLIF(min(NULLIF((ci.item_data->>'price')::numeric, 0)), 0), 1) AS max_min_ratio
FROM catalogue_items ci
JOIN identities i ON i.identity_id = ci.entity_id
WHERE jsonb_typeof(ci.item_data->'price') = 'number'
GROUP BY 1,2 HAVING count(*) > 1 ORDER BY 4 DESC NULLS LAST LIMIT 20;

\echo ''
\echo '=== E · the OTHER price homes — scope check ==='
SELECT 'catalogue_adoption.commercials' AS location, count(*) AS rows
  FROM catalogue_adoption WHERE commercials IS NOT NULL AND commercials <> '{}'::jsonb
UNION ALL
SELECT 'catalogue_source.items', count(*) FROM catalogue_source WHERE items IS NOT NULL;
-- IN SCOPE for step 3: catalogue_items only.
-- catalogue_adoption.commercials is a per-adopter price override and needs the same treatment — deliberately a
--   SEPARATE migration, because its shape is {name: {price, unit}} and mixing two shapes in one apply doubles the
--   ways a failure can be caused and halves your ability to tell which caused it.
-- catalogue_source.items belongs to the SOURCE entity, not the adopter, so its currency comes from a different
--   identity. Same reason: separate.
--
-- ❌ NEVER IN SCOPE: chits, chit_details, line_items, business_json.
--    Those are MINTED records. Several are covered by a seal hash; rewriting one breaks its seal and destroys the
--    tamper-evidence the whole rail exists to provide. Historical chits already carry currency_code on the header.
--    A minted record is history. History does not get migrated.
