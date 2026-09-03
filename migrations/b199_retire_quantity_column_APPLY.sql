-- b199 APPLY — retire the `quantity` column from every default schema where no product ever recorded a value.
--
-- ⚠️ RUN b199_retire_quantity_column_DRYRUN.sql FIRST and read its VERDICT. This deletes exactly the rows it
--    listed as "retire", nothing else.
-- ⚠️ RUN WITHOUT RLS. The guard below REFUSES TO DELETE ANYTHING when the session can see zero catalogue items,
--    because under RLS-with-no-context every schema looks safe to retire — the false pass the dry run warns about.
-- ⚠️ IT COMMITS. The result set at the end is a verification read taken AFTER the commit.
--
-- Reversible: INSERT INTO schema_fields (schema_id, field_name, field_key, field_type, required, min_value,
-- display_order) VALUES ('<schema_id>', 'Quantity', 'quantity', 'number', true, 1, <n>) for any row removed here.

BEGIN;

DELETE FROM schema_fields sf
 USING entity_schemas es
 WHERE es.schema_id = sf.schema_id
   AND sf.field_key = 'quantity'
   -- the RLS guard: if this session sees no products it may not judge any schema safe
   AND (SELECT count(*) FROM catalogue_items WHERE is_active = true) > 0
   -- only where nothing recorded a value
   AND NOT EXISTS (
         SELECT 1 FROM catalogue_items ci
          WHERE ci.entity_id = es.entity_id AND ci.is_active = true
            AND COALESCE(btrim(ci.item_data->>'quantity'), '') <> '');

COMMIT;

-- VERIFICATION, after the commit.
SELECT 'AFTER' AS section,
       (SELECT count(*) FROM catalogue_items WHERE is_active = true)::text AS items_visible,
       (SELECT count(*) FROM schema_fields WHERE field_key = 'quantity')::text AS schemas_still_declaring_quantity,
       CASE WHEN (SELECT count(*) FROM catalogue_items WHERE is_active = true) = 0
              THEN 'RLS BLOCKED THIS SESSION - nothing was deleted. Re-run as a role that bypasses RLS.'
            WHEN (SELECT count(*) FROM schema_fields WHERE field_key = 'quantity') = 0
              THEN 'DONE - no schema declares quantity.'
            ELSE 'DONE - the remaining rows have product data in them and were kept on purpose (see DRYRUN DETAIL).'
       END AS verdict;
