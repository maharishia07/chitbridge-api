-- b200 DRY RUN — does schema_fields already carry the column attributes (unit · leg · via)?
--
-- ⚠️ READS ONLY. Nothing is written. One result set. Then run b200_column_attributes_APPLY.sql.
-- Runs the same WITH or WITHOUT RLS: schema_fields has no row-level security.
--
-- WHY (catalogue/OBSERVATIONS-4-REVIEW.md, obs 2): the Columns row carried three facts — name, unit of measure and
-- datatype — and the unit was baked into the label ("Coverage (sq ft/L)") because schema_fields had nowhere to put
-- it. `unit` takes a UN/ECE Recommendation 20 code (KGM · LTR · MTK · H87 …), the list GS1, Peppol and INV-01 use.
-- `leg` / `via` are design intent — where a column's value SHOULD come from (FIX-4, column-only).
--
-- HOW TO READ IT: one row per attribute. present = true means APPLY has nothing to do for that column.

SELECT a.col AS attribute,
       (c.column_name IS NOT NULL) AS present,
       c.data_type
  FROM (VALUES ('unit'), ('leg'), ('via')) AS a(col)
  LEFT JOIN information_schema.columns c
    ON c.table_schema = 'public' AND c.table_name = 'schema_fields' AND c.column_name = a.col
 ORDER BY a.col;
