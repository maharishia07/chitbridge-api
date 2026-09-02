-- b198 DRY RUN — which catalogue columns exist in the DATA but in no DECLARATION?
--
-- ⚠️ READS ONLY. Nothing is written. Run this first, read the result, then run b198_..._APPLY.sql.
--
-- WHY: `catalogue_items.item_data` is free-form jsonb and, until the declare-first writer landed, every write path
-- except the CSV import could leave a key behind that no `schema_fields` row described. Those keys are real —
-- they are in the export and in the template — but the Columns panel could not see them, which is what made the
-- three surfaces disagree. This finds them so they can be declared.
--
-- ⚠️ THE APPLY STEP IS ADDITIVE AND REVERSIBLE. It inserts `schema_fields` rows for keys that already exist in the
-- data. It changes NO product, deletes nothing, and makes nothing required. If it is wrong, the rows it added can
-- be deleted by key.
--
-- Columns deliberately excluded, and why (they are values, not columns — see lib/catalogue-columns.RESERVED):
--   status · avail · categories        — system fields, managed by their own controls, shape is load-bearing
--   category_names · category          — a travelling copy of the names, and the retired single-category key
--   commercials                        — an adopter's overlay on a referenced line
--   synonyms · source_ref              — matcher hints and system provenance
--   quantity · is_active · order_input — per-order or per-action, never a property of a product
--   item_id · entity_id · schema_id    — record ids
--   *_currency                         — a price carries its currency in the money shape

WITH reserved AS (
  SELECT unnest(ARRAY[
    'status','avail','categories','category_names','category','commercials','synonyms','source_ref',
    'quantity','is_active','order_input','item_id','entity_id','schema_id'
  ]) AS k
),
observed AS (
  SELECT ci.entity_id,
         kv.key                         AS field_key,
         count(*)::int                  AS used_by,
         -- text unless every recorded value parses as a number — the same rule csv-preflight.inferType applies
         CASE WHEN bool_and(kv.value ~ '^\s*-?[0-9]+(\.[0-9]+)?\s*$') THEN 'number' ELSE 'text' END AS field_type
    FROM catalogue_items ci
    CROSS JOIN LATERAL jsonb_each_text(ci.item_data) AS kv
   WHERE ci.is_active = true
     AND kv.value IS NOT NULL
     AND btrim(kv.value) <> ''
     AND kv.key NOT IN (SELECT k FROM reserved)
     AND kv.key NOT LIKE '%\_currency'
   GROUP BY ci.entity_id, kv.key
),
declared AS (
  SELECT es.entity_id, sf.field_key
    FROM entity_schemas es
    JOIN schema_fields sf ON sf.schema_id = es.schema_id
   WHERE es.status = 'active' AND es.is_default = true
),
gap AS (
  SELECT o.*
    FROM observed o
    LEFT JOIN declared d ON d.entity_id = o.entity_id AND d.field_key = o.field_key
   WHERE d.field_key IS NULL
)
SELECT 1 AS ord, 'SUMMARY' AS section,
       (SELECT count(DISTINCT entity_id) FROM gap)::text AS entities_affected,
       (SELECT count(*) FROM gap)::text                  AS columns_to_declare,
       (SELECT count(*) FROM entity_schemas WHERE status='active' AND is_default=true)::text AS schemas_total,
       NULL::text AS field_key, NULL::text AS field_type, NULL::text AS used_by
UNION ALL
SELECT 2, 'DETAIL',
       g.entity_id::text, NULL, NULL,
       g.field_key, g.field_type, g.used_by::text
  FROM gap g
 ORDER BY ord, field_key;
