-- b200 APPLY — give a column its own attributes: unit (UN/ECE Rec 20 code) · leg · via.
--
-- ⚠️ ADDITIVE ONLY. Three nullable text columns on schema_fields. No row is touched, no default is written, nothing
--    is required. Idempotent: IF NOT EXISTS on each. Runs WITH or WITHOUT RLS (schema_fields has none).
-- ⚠️ DEPLOY FIRST, MIGRATE SECOND — the API gates every read and write of these on hasColumn, so the order is
--    safe either way, but the Types tab only offers Unit once this has run.
-- ⚠️ IT COMMITS. The result set at the end is a verification read taken AFTER the commit.
--
-- Values are validated in the API (lib/column-rules TYPES · LEGS · VIAS), not by a CHECK here — a CHECK would need
-- a migration every time the vocabulary grows, and ADD CONSTRAINT has no IF NOT EXISTS to keep this re-runnable.
--
-- Reversible: ALTER TABLE schema_fields DROP COLUMN unit, DROP COLUMN leg, DROP COLUMN via;

BEGIN;

ALTER TABLE schema_fields ADD COLUMN IF NOT EXISTS unit text;   -- UN/ECE Rec 20, e.g. KGM · LTR · MTK · H87
ALTER TABLE schema_fields ADD COLUMN IF NOT EXISTS leg  text;   -- system | customer | compute | cb
ALTER TABLE schema_fields ADD COLUMN IF NOT EXISTS via  text;   -- ERP | IoT | AI

COMMIT;

-- VERIFICATION, after the commit. Expect three rows, present = true.
SELECT a.col AS attribute,
       (c.column_name IS NOT NULL) AS present,
       CASE WHEN c.column_name IS NOT NULL THEN 'DONE' ELSE 'MISSING - the ALTER did not apply' END AS verdict
  FROM (VALUES ('unit'), ('leg'), ('via')) AS a(col)
  LEFT JOIN information_schema.columns c
    ON c.table_schema = 'public' AND c.table_name = 'schema_fields' AND c.column_name = a.col
 ORDER BY a.col;
