-- READ-2026-10-20-5 · where the 506 MB goes (Supabase Free limit 500 MB; restriction from 10 Nov if still over)
-- READ-ONLY. Changes nothing. Run in the Supabase SQL editor; paste the ONE json value back.
SELECT json_build_object(
  'database_mb', round(pg_database_size(current_database()) / 1048576.0, 1),
  -- the 15 biggest tables: total = table + indexes + toast; dead rows are space VACUUM can give back
  'top_tables', (SELECT json_agg(t) FROM (
      SELECT n.nspname || '.' || c.relname                                   AS tbl,
             round(pg_total_relation_size(c.oid) / 1048576.0, 1)            AS total_mb,
             round(pg_relation_size(c.oid) / 1048576.0, 1)                  AS heap_mb,
             round(pg_indexes_size(c.oid) / 1048576.0, 1)                   AS index_mb,
             round(COALESCE(pg_total_relation_size(c.reltoastrelid), 0) / 1048576.0, 1) AS toast_mb,
             s.n_live_tup AS live_rows, s.n_dead_tup AS dead_rows,
             to_char(GREATEST(s.last_vacuum, s.last_autovacuum), 'YYYY-MM-DD') AS last_vacuum
        FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
        LEFT JOIN pg_stat_user_tables s ON s.relid = c.oid
       WHERE c.relkind = 'r' AND n.nspname NOT IN ('pg_catalog', 'information_schema')
       ORDER BY pg_total_relation_size(c.oid) DESC
       LIMIT 15) t),
  -- space by schema (auth, storage, net, cron... are Supabase's own and count too)
  'by_schema', (SELECT json_agg(t) FROM (
      SELECT n.nspname AS schema, round(sum(pg_total_relation_size(c.oid)) / 1048576.0, 1) AS mb
        FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE c.relkind IN ('r', 'm')
       GROUP BY 1 ORDER BY 2 DESC LIMIT 10) t),
  -- definition_version (the biggest table in census 2): which kinds and which shops own the versions
  'defver_by_kind', (SELECT json_agg(t) FROM (
      SELECT d.kind, count(*) AS versions, count(DISTINCT v.definition_id) AS definitions,
             round(sum(pg_column_size(v.rules)) / 1048576.0, 1) AS rules_mb,
             to_char(min(v.created_at), 'YYYY-MM-DD') AS oldest
        FROM definition_version v LEFT JOIN definition d ON d.definition_id = v.definition_id
       GROUP BY 1 ORDER BY 2 DESC LIMIT 10) t),
  'defver_top_entities', (SELECT json_agg(t) FROM (
      SELECT v.entity_id, count(*) AS versions, round(sum(pg_column_size(v.rules)) / 1048576.0, 1) AS rules_mb
        FROM definition_version v GROUP BY 1 ORDER BY 2 DESC LIMIT 8) t),
  'defver_most_versions', (SELECT json_agg(t) FROM (
      SELECT v.definition_id, d.kind, count(*) AS versions
        FROM definition_version v LEFT JOIN definition d ON d.definition_id = v.definition_id
       GROUP BY 1, 2 ORDER BY 3 DESC LIMIT 5) t)
) AS db_size_census;
