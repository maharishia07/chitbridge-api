-- READ-2026-10-19-2-index-census.sql · DB-5 (plan topic 7d) · census 2 of 4 · READ-ONLY.
--
-- WHAT IT DOES: the index picture for public, ops and metrics, as proposals only (nothing is added or dropped from this file):
--    fk_without_index   every foreign key whose columns do not lead any index (a delete or join on the parent then scans the child)
--    duplicate_indexes  two or more indexes on the same table with the same columns, operator classes, expressions and WHERE
--    unused_indexes     non-unique, non-primary indexes with 0 scans since the statistics were last reset (largest first, top 40)
--    biggest_tables     the 30 largest tables with live rows, sequential vs index scans (a big table read by seq scan = a missing index)
--    stats_since        when the counters started; "unused" means unused since then, so a recent reset makes that list weak
--
-- READ-ONLY: SELECT on the catalog and the statistics views. It writes nothing, creates nothing, reads no business rows.
-- HOW: Supabase SQL editor, as postgres. One statement → ONE row, ONE column ("index_census"). Copy the JSON value and paste it back to Claude.
-- Slow queries are census 3 (READ-2026-10-19-3-slow-queries.sql), kept apart because it needs the pg_stat_statements extension.
WITH sch AS (SELECT oid, nspname FROM pg_namespace WHERE nspname IN ('public', 'ops', 'metrics')),
ourtbl AS (
  SELECT c.oid, CASE WHEN s.nspname = 'public' THEN '' ELSE s.nspname || '.' END || c.relname AS t
    FROM pg_class c JOIN sch s ON s.oid = c.relnamespace
   WHERE c.relkind IN ('r', 'p')
     AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.classid = 'pg_class'::regclass AND d.objid = c.oid AND d.deptype = 'e')
),
fk AS (
  SELECT o.t, k.conname,
         (SELECT string_agg(a.attname, ', ' ORDER BY u.ord) FROM unnest(k.conkey) WITH ORDINALITY u(attnum, ord)
            JOIN pg_attribute a ON a.attrelid = k.conrelid AND a.attnum = u.attnum)       AS cols,
         k.confrelid::regclass::text                                                     AS refs
    FROM pg_constraint k JOIN ourtbl o ON o.oid = k.conrelid
   WHERE k.contype = 'f'
     AND NOT EXISTS (
       SELECT 1 FROM pg_index i
        WHERE i.indrelid = k.conrelid
          AND (string_to_array(i.indkey::text, ' ')::int2[])[1:cardinality(k.conkey)] @> k.conkey
          AND (string_to_array(i.indkey::text, ' ')::int2[])[1:cardinality(k.conkey)] <@ k.conkey)
),
dup AS (
  SELECT o.t, array_agg(ci.relname::text ORDER BY ci.relname) AS idx, pg_size_pretty(sum(pg_relation_size(i.indexrelid))) AS size
    FROM pg_index i JOIN ourtbl o ON o.oid = i.indrelid JOIN pg_class ci ON ci.oid = i.indexrelid
   GROUP BY o.t, i.indrelid, i.indkey::text, i.indclass::text, coalesce(pg_get_expr(i.indexprs, i.indrelid), ''),
            coalesce(pg_get_expr(i.indpred, i.indrelid), '')
  HAVING count(*) > 1
),
unused AS (
  SELECT o.t, s.indexrelname::text AS idx, s.idx_scan, pg_relation_size(s.indexrelid) AS bytes
    FROM pg_stat_user_indexes s JOIN ourtbl o ON o.oid = s.relid JOIN pg_index i ON i.indexrelid = s.indexrelid
   WHERE s.idx_scan = 0 AND NOT i.indisunique AND NOT i.indisprimary
   ORDER BY pg_relation_size(s.indexrelid) DESC
   LIMIT 40
),
big AS (
  SELECT o.t, st.n_live_tup, st.seq_scan, st.idx_scan, pg_total_relation_size(o.oid) AS bytes
    FROM ourtbl o JOIN pg_stat_user_tables st ON st.relid = o.oid
   ORDER BY pg_total_relation_size(o.oid) DESC
   LIMIT 30
)
SELECT jsonb_build_object(
  'census',      'READ-2026-10-19-2 indexes',
  'at',          now(),
  'db',          current_database(),
  'stats_since', (SELECT stats_reset FROM pg_stat_database WHERE datname = current_database()),
  'counts',      jsonb_build_object('fk_without_index', (SELECT count(*) FROM fk), 'duplicate_sets', (SELECT count(*) FROM dup),
                                    'unused_listed', (SELECT count(*) FROM unused)),
  'fk_without_index',  (SELECT jsonb_agg(jsonb_build_object('table', t, 'fk', conname, 'cols', cols, 'refs', refs) ORDER BY t, conname) FROM fk),
  'duplicate_indexes', (SELECT jsonb_agg(jsonb_build_object('table', t, 'indexes', idx, 'size', size) ORDER BY t) FROM dup),
  'unused_indexes',    (SELECT jsonb_agg(jsonb_build_object('table', t, 'index', idx, 'size', pg_size_pretty(bytes)) ORDER BY bytes DESC) FROM unused),
  'biggest_tables',    (SELECT jsonb_agg(jsonb_build_object('table', t, 'rows', n_live_tup, 'seq_scan', seq_scan, 'idx_scan', idx_scan,
                                                            'size', pg_size_pretty(bytes)) ORDER BY bytes DESC) FROM big)
) AS index_census;
