-- remove-shelf-zone.sql — drop the test column my live import created on Beta's catalogue definition.
--
-- 2026-08-06. Verifying the import end-to-end on the live API meant actually creating a column; `Shelf Zone` was
-- that column. The two test PRODUCTS were removed through the API immediately after, but there is no route that
-- drops a schema field, so this is the one thing left behind.
--
-- Scope: ONE field, on ONE entity (Beta), and only if no product is still using it. It is written so that running
-- it twice is harmless and running it when something unexpected is true does nothing at all.

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
 WHERE sf.field_key = 'shelf_zone';

-- 2 — Is any product still carrying a value for it? This MUST come back 0.
--     If it does not, stop and ROLLBACK: a column in use is data, not residue.
SELECT COUNT(*) AS products_still_using_shelf_zone
  FROM catalogue_items ci
 WHERE ci.is_active = true
   AND ci.item_data ? 'shelf_zone';

-- 3 — Drop it, but ONLY where nothing uses it. The NOT EXISTS makes the guard part of the statement rather than
--     something a person has to remember to check between two windows.
DELETE FROM schema_fields sf
 WHERE sf.field_key = 'shelf_zone'
   AND NOT EXISTS (
     SELECT 1
       FROM catalogue_items ci
       JOIN entity_schemas es ON es.schema_id = sf.schema_id
      WHERE ci.entity_id = es.entity_id
        AND ci.is_active = true
        AND ci.item_data ? 'shelf_zone'
   );

-- 4 — Confirm it is gone. Expect 0 rows.
SELECT COUNT(*) AS shelf_zone_fields_remaining
  FROM schema_fields WHERE field_key = 'shelf_zone';

COMMIT;
