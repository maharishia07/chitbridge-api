-- b180 · VERIFY — run after the apply. Confirms the index exists, is VALID, and is the shape the pulse needs.
--
-- ⚠️ "EXISTS" IS NOT "USABLE". A CONCURRENTLY build that failed part-way leaves the index in place and INVALID:
-- the planner ignores it, every write still maintains it, and `\d` shows it as if all were well. indisvalid is
-- the only honest check, which is why this is a separate file rather than a line at the end of the apply.

SELECT
  i.indexrelid::regclass::text  AS index_name,
  i.indisvalid                  AS is_valid,
  CASE WHEN i.indisvalid THEN 'ready — the planner will use it'
       ELSE 'INVALID: the CONCURRENTLY build did not finish. DROP INDEX CONCURRENTLY cs_entity_updated_idx; then re-run the apply.'
  END                           AS verdict,
  pg_size_pretty(pg_relation_size(i.indexrelid)) AS size,
  pg_get_indexdef(i.indexrelid) AS definition
FROM pg_index i
WHERE i.indrelid = 'chit_status'::regclass
  AND i.indexrelid::regclass::text LIKE '%cs_entity_updated_idx%';
