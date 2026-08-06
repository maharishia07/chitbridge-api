-- remove-shelf-zone.sql — drop the test columns my live verification created on Beta's catalogue definition.
--
-- 2026-08-06. Verifying the import end-to-end on the live API meant actually creating columns: `shelf_zone` (the
-- first round trip), `my_testing` (reproducing Athi's report), and `aaa_zone` (proving a column that sorts FIRST
-- alphabetically still appends rather than jumping to the front). All test PRODUCTS were removed through the API
-- immediately after, but there is no route that drops a schema field, so these are what is left behind.
--
-- ⚠️ NOT included, deliberately: `sku` and `unit`. The same verification registered those on Beta, and that was not
-- residue — Beta's products genuinely carry them, they simply had no declared position before. Removing them would
-- put those two columns back to being ordered by a rule instead of by a stored fact, which is the thing we just
-- fixed. Leave them.
--
-- Scope: three fields, on one entity, and only where no product is still using them. Running it twice is harmless,
-- and running it when something unexpected is true does nothing at all.

BEGIN;

-- 1 — What we are about to touch. Read this before committing.
SELECT i.display_name,
       es.schema_id,
       sf.field_id,
       sf.field_key,
       sf.field_name,
       sf.required
  FROM schema_fields sf
  JOIN entity_schemas es ON es.schema_id = sf.schema_id
  JOIN identities i      ON i.identity_id = es.entity_id
 WHERE sf.field_key IN ('shelf_zone','my_testing','aaa_zone');

-- 2 — Is any product still carrying a value for it? This MUST come back 0.
--     If it does not, stop and ROLLBACK: a column in use is data, not residue.
SELECT COUNT(*) AS products_still_using_these
  FROM catalogue_items ci
 WHERE ci.is_active = true
   AND (ci.item_data ?| ARRAY['shelf_zone','my_testing','aaa_zone']);

-- 2b — WHICH field is used, and by how many products, ON ITS OWN SCHEMA.
--
-- ⚠️ The first version of the guard below asked "is ANY of the three keys in use on this entity?" rather than "is
-- THIS field in use?" — so one product carrying `my_testing` also protected `aaa_zone` on the same schema. It
-- refused in the safe direction, but it refused too much, and the count in step 4 then said "1 remaining" without
-- saying which or why. A guard you cannot interpret is only half a guard.
SELECT i.display_name,
       sf.field_key,
       (SELECT COUNT(*) FROM catalogue_items ci
         WHERE ci.entity_id = es.entity_id AND ci.is_active = true
           AND ci.item_data ? sf.field_key) AS products_using_this_field
  FROM schema_fields sf
  JOIN entity_schemas es ON es.schema_id = sf.schema_id
  JOIN identities i      ON i.identity_id = es.entity_id
 WHERE sf.field_key IN ('shelf_zone','my_testing','aaa_zone')
 ORDER BY i.display_name, sf.field_key;

-- 3 — Drop it, but ONLY where nothing uses THAT field. The NOT EXISTS makes the guard part of the statement rather
--     than something a person has to remember to check between two windows.
DELETE FROM schema_fields sf
 WHERE sf.field_key IN ('shelf_zone','my_testing','aaa_zone')
   AND NOT EXISTS (
     SELECT 1
       FROM catalogue_items ci
       JOIN entity_schemas es ON es.schema_id = sf.schema_id
      WHERE ci.entity_id = es.entity_id
        AND ci.is_active = true
        AND ci.item_data ? sf.field_key          -- THIS field, not "any of the three"
   );

-- 4 — What is left, and why. Anything still here is a field a live product is using.
SELECT sf.field_key, i.display_name,
       (SELECT COUNT(*) FROM catalogue_items ci
         WHERE ci.entity_id = es.entity_id AND ci.is_active = true
           AND ci.item_data ? sf.field_key) AS still_used_by
  FROM schema_fields sf
  JOIN entity_schemas es ON es.schema_id = sf.schema_id
  JOIN identities i      ON i.identity_id = es.entity_id
 WHERE sf.field_key IN ('shelf_zone','my_testing','aaa_zone');

COMMIT;

-- ─────────────────────────────────────────────────────────────────────────────────────────────────────────────
-- IF A FIELD SURVIVES because a product is using it, that is the guard doing its job — the column is DATA, not
-- residue. You have two honest options, and neither should be automatic:
--
--   (a) LEAVE IT. It is a real column on a real product. This is the right answer if the value matters.
--
--   (b) REMOVE THE VALUE FIRST, THEN THE FIELD. Destructive: it edits products. Run the SELECT first and look at
--       what you are about to erase. Nothing below runs unless you uncomment it.
--
-- SELECT item_id, item_data->>'my_testing' AS value, item_data->>'name' AS product
--   FROM catalogue_items WHERE is_active = true AND item_data ? 'my_testing';
--
-- BEGIN;
-- UPDATE catalogue_items SET item_data = item_data - 'my_testing', updated_at = NOW()
--  WHERE is_active = true AND item_data ? 'my_testing';
-- DELETE FROM schema_fields WHERE field_key = 'my_testing';
-- COMMIT;
--
-- ⚠️ `item_data - 'key'` removes the key entirely. There is no undo and no history table for catalogue_items.
