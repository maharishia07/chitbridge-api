-- b620 · APPLY — the one index the notifications poll reads by, created only if the b619 dry run found it missing.
--
-- SEC-SMALL item 6 (2026-10-14). The feed (routes/notifications.js FEED_FROM) and the badge count read state_log by
-- `entity_id = $1 AND created_at > now() - interval '90 days'`, every 20 seconds per open tab. The baseline created
-- idx_state_log_entity (entity_id, created_at DESC) for exactly that shape (000_baseline_part2.sql:265); this file is
-- the same index, idempotent, for a database where b619's verdict says it is not there. Where it is, this is a no-op.
--
-- ⚠️⚠️ RUN THIS STATEMENT ON ITS OWN. There is deliberately NO BEGIN/COMMIT: `CREATE INDEX CONCURRENTLY` cannot run
--    inside a transaction block (ERROR: CREATE INDEX CONCURRENTLY cannot run inside a transaction block). If the SQL
--    editor wraps statements for you, run this file by itself so nothing else joins it in one block.
-- ⚠️ CONCURRENTLY IS THE POINT. A plain CREATE INDEX locks every WRITE to state_log for the duration — that is every
--    status advance, delivery and dispute on the platform. CONCURRENTLY builds without that lock; slower, two passes.
-- ⚠️ IF IT FAILS PART-WAY it leaves an INVALID index behind, unused but maintained. The check below names that state
--    rather than reporting success. To clear one:  DROP INDEX CONCURRENTLY idx_state_log_entity;  then run again.
--
-- RLS: an index changes no policy; state_log keeps rls_entity (entity_id = app.current_entity, b49) and append-only (b315).
-- Reversible: DROP INDEX CONCURRENTLY idx_state_log_entity;   (only where b619 showed it absent before this ran)

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_state_log_entity
  ON state_log (entity_id, created_at DESC);

-- verify: expect one row, valid = true. valid = false means the build failed part-way — drop it and run again.
SELECT i.indexname, x.indisvalid AS valid, pg_size_pretty(pg_relation_size(x.indexrelid)) AS size
  FROM pg_indexes i JOIN pg_index x ON x.indexrelid = (quote_ident(i.schemaname) || '.' || quote_ident(i.indexname))::regclass
 WHERE i.tablename = 'state_log' AND i.indexname = 'idx_state_log_entity';
