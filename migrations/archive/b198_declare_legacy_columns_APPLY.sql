-- b198 APPLY — declare the catalogue columns that exist in the data and in no declaration.
--
-- ⚠️ RUN b198_declare_legacy_columns_DRYRUN.sql FIRST and read its DETAIL rows. This inserts exactly what that
-- listed, nothing else.
--
-- ⚠️ ADDITIVE ONLY. Inserts `schema_fields` rows for keys ALREADY PRESENT in `item_data`. It updates no product,
-- deletes nothing, marks nothing required, and moves no existing column: each new column takes the next
-- display_order on its own schema, so nothing a merchant already sees changes position.
--
-- ⚠️ IT COMMITS. The result set at the end is a VERIFICATION read taken AFTER the commit, so what it prints is
-- what is actually stored — not what would have been stored if the transaction had held.
--
-- Reversible: DELETE FROM schema_fields WHERE field_key = '<key>' AND schema_id = '<id>' for anything added here.

BEGIN;

WITH reserved AS (
  SELECT unnest(ARRAY[
    'status','avail','categories','category_names','category','commercials','synonyms','source_ref',
    'quantity','is_active','order_input','item_id','entity_id','schema_id'
  ]) AS k
),
observed AS (
  SELECT ci.entity_id,
         kv.key AS field_key,
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
target AS (
  SELECT es.schema_id, o.field_key, o.field_type
    FROM observed o
    JOIN entity_schemas es
      ON es.entity_id = o.entity_id AND es.status = 'active' AND es.is_default = true
    LEFT JOIN schema_fields sf
      ON sf.schema_id = es.schema_id AND sf.field_key = o.field_key
   WHERE sf.field_key IS NULL
),
-- ⚠️ THE ORDER MATTERS AND MUST BE DETERMINISTIC. Appended alphabetically per schema, after everything already
-- declared — the same order lib/catalogue-columns.resolveColumns has been showing these keys in, so declaring
-- them moves nothing on screen.
numbered AS (
  SELECT t.schema_id, t.field_key, t.field_type,
         COALESCE((SELECT max(sf.display_order) FROM schema_fields sf WHERE sf.schema_id = t.schema_id), 0)
           + row_number() OVER (PARTITION BY t.schema_id ORDER BY t.field_key) AS display_order
    FROM target t
)
INSERT INTO schema_fields (schema_id, field_name, field_key, field_type, required, display_order)
SELECT schema_id, field_key, field_key, field_type, false, display_order
  FROM numbered;

COMMIT;

-- VERIFICATION, after the commit: how many undeclared keys remain anywhere? Expect 0.
WITH reserved AS (
  SELECT unnest(ARRAY[
    'status','avail','categories','category_names','category','commercials','synonyms','source_ref',
    'quantity','is_active','order_input','item_id','entity_id','schema_id'
  ]) AS k
),
observed AS (
  SELECT ci.entity_id, kv.key AS field_key
    FROM catalogue_items ci
    CROSS JOIN LATERAL jsonb_each_text(ci.item_data) AS kv
   WHERE ci.is_active = true AND kv.value IS NOT NULL AND btrim(kv.value) <> ''
     AND kv.key NOT IN (SELECT k FROM reserved)
     AND kv.key NOT LIKE '%\_currency'
   GROUP BY ci.entity_id, kv.key
),
declared AS (
  SELECT es.entity_id, sf.field_key
    FROM entity_schemas es
    JOIN schema_fields sf ON sf.schema_id = es.schema_id
   WHERE es.status = 'active' AND es.is_default = true
)
SELECT 'AFTER' AS section,
       count(*)::text AS undeclared_remaining,
       CASE WHEN count(*) = 0 THEN 'every column in the data is now declared'
            ELSE 'still undeclared — these entities have no active default schema, so there was nowhere to add them'
       END AS verdict,
       COALESCE(string_agg(DISTINCT o.entity_id::text, ', '), '') AS entities
  FROM observed o
  LEFT JOIN declared d ON d.entity_id = o.entity_id AND d.field_key = o.field_key
 WHERE d.field_key IS NULL;
