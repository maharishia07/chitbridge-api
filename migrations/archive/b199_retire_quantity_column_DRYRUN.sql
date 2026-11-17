-- b199 DRY RUN — which default schemas still declare `quantity`, and would any of them lose data if it went?
--
-- ⚠️ READS ONLY. Nothing is written. Run this first, read the VERDICT row, then run b199_..._APPLY.sql.
-- ⚠️ RUN WITHOUT RLS (the SQL editor's postgres role). `catalogue_items` is row-level secured; a session that
--    sees no items would report every schema as "safe to retire" — a false pass. The VERDICT row prints how
--    many items it could see so that case is visible, and the APPLY refuses to run on zero.
--
-- WHY (catalogue/QUESTIONS.md Q6, decided 2026-09-03): `schema-bootstrap` declared `quantity` on every new
-- entity as a REQUIRED column, while csv-preflight.BLOCKED refuses it outright — "quantity is what a customer
-- orders, not something a product carries" — and validateAgainst skips it. A required column no import may fill
-- and no validator checks. It becomes a live defect the moment the product form renders declared columns:
-- a mandatory input nothing may satisfy. The bootstrap no longer declares it; this retires it from schemas
-- that already have it.
--
-- ⚠️ ONLY WHERE NOTHING RECORDED A VALUE. A schema whose entity has any active product carrying a non-empty
-- item_data.quantity KEEPS the column — that is data somebody put there, and a column with data is removed by a
-- person through the Columns panel (which shows the count), never by a migration.

WITH seen AS (
  SELECT count(*)::int AS items_visible FROM catalogue_items WHERE is_active = true
),
q AS (
  SELECT sf.schema_id, sf.field_key, sf.required, sf.display_order, es.entity_id,
         (SELECT count(*) FROM catalogue_items ci
           WHERE ci.entity_id = es.entity_id AND ci.is_active = true
             AND COALESCE(btrim(ci.item_data->>'quantity'), '') <> '') AS products_with_value
    FROM schema_fields sf
    JOIN entity_schemas es ON es.schema_id = sf.schema_id
   WHERE sf.field_key = 'quantity'
)
SELECT 1 AS ord, 'VERDICT' AS section,
       (SELECT items_visible FROM seen)::text                          AS items_visible,
       (SELECT count(*) FROM q)::text                                  AS schemas_declaring_quantity,
       (SELECT count(*) FROM q WHERE products_with_value = 0)::text    AS would_retire,
       (SELECT count(*) FROM q WHERE products_with_value > 0)::text    AS kept_has_data,
       CASE WHEN (SELECT items_visible FROM seen) = 0
              THEN 'RLS BLOCKED THIS SESSION - every schema would look safe. Do NOT apply; re-run as a role that bypasses RLS.'
            WHEN (SELECT count(*) FROM q) = 0
              THEN 'NOTHING TO DO - no schema declares quantity.'
            ELSE 'APPLY will delete exactly the would_retire rows; kept_has_data rows stay (see DETAIL).'
       END AS verdict,
       NULL::text AS entity, NULL::text AS schema_id, NULL::text AS products_with_value
UNION ALL
SELECT 2, 'DETAIL', NULL, NULL, NULL, NULL,
       CASE WHEN products_with_value > 0 THEN 'KEEP - has data' ELSE 'retire' END,
       entity_id::text, schema_id::text, products_with_value::text
  FROM q
 ORDER BY ord, entity;
