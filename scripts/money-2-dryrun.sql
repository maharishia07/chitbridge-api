-- money-2-dryrun.sql — READ ONLY. Shows the exact before/after for every row step 3 would touch.
--
-- This is not a summary. It renders the literal JSON that would be written, so the change can be checked by eye
-- rather than trusted. Run it after step 1 comes back clean, and read the sample before running step 3.

\echo '=== BEFORE → AFTER · a sample of 25 rows ==='
SELECT
  i.display_name                                        AS entity,
  left(coalesce(ci.item_data->>'name', '(unnamed)'), 28) AS item,
  ci.item_data->'price'                                 AS before,
  jsonb_build_object(
    'amount',   (ci.item_data->>'price')::numeric,
    'currency', i.currency_code
  )                                                     AS after
FROM catalogue_items ci
JOIN identities i ON i.identity_id = ci.entity_id
WHERE jsonb_typeof(ci.item_data->'price') = 'number'
  AND i.currency_code ~ '^[A-Z]{3}$'
ORDER BY i.display_name, ci.item_data->>'name'
LIMIT 25;

\echo ''
\echo '=== the full row, as it would be written (first 3) ==='
-- Includes the provenance keys. `price_currency_assumed` is the important one: it records permanently that this
-- denomination was INFERRED from the entity's setting at migration time, not declared by anyone. A future reader
-- must be able to tell a guess from a statement, forever.
SELECT
  left(coalesce(ci.item_data->>'name','(unnamed)'), 24) AS item,
  jsonb_pretty(
    jsonb_set(ci.item_data, '{price}',
      jsonb_build_object('amount', (ci.item_data->>'price')::numeric, 'currency', i.currency_code))
    || jsonb_build_object(
         'price_stamped_at',       to_jsonb(now()),
         'price_stamped_from',     to_jsonb('entity.currency_code'::text),
         'price_currency_assumed', to_jsonb(true)
       )
  ) AS full_row_after
FROM catalogue_items ci
JOIN identities i ON i.identity_id = ci.entity_id
WHERE jsonb_typeof(ci.item_data->'price') = 'number'
  AND i.currency_code ~ '^[A-Z]{3}$'
LIMIT 3;

\echo ''
\echo '=== TALLY · what step 3 will and will not do ==='
SELECT
  count(*) FILTER (WHERE jsonb_typeof(ci.item_data->'price') = 'number'
                     AND i.currency_code ~ '^[A-Z]{3}$')                       AS will_stamp,
  count(*) FILTER (WHERE jsonb_typeof(ci.item_data->'price') = 'number'
                     AND (i.currency_code IS NULL OR i.currency_code !~ '^[A-Z]{3}$')) AS blocked_no_currency,
  count(*) FILTER (WHERE jsonb_typeof(ci.item_data->'price') = 'object')       AS already_stamped_skipped,
  count(*) FILTER (WHERE ci.item_data->'price' IS NULL
                      OR jsonb_typeof(ci.item_data->'price') = 'null')         AS no_price_left_alone,
  count(*) FILTER (WHERE jsonb_typeof(ci.item_data->'price') = 'string')       AS strings_investigate
FROM catalogue_items ci
JOIN identities i ON i.identity_id = ci.entity_id;

\echo ''
\echo '=== ROLLBACK REHEARSAL — prove the way back exists before you need it ==='
-- Step 3 writes a backup table. This is the query that reverses it. Read it now, while nothing is broken.
--
--   UPDATE catalogue_items ci
--   SET item_data = b.item_data_before
--   FROM catalogue_items_price_backup b
--   WHERE b.item_id = ci.item_id;
--
-- Note what rollback does NOT undo: any row a customer has ordered from since the stamp. Those chits are minted and
-- carry their own currency, which is correct and stays correct — but the catalogue and the chits would then
-- disagree about whether the price was ever stamped. Roll back promptly or not at all.
