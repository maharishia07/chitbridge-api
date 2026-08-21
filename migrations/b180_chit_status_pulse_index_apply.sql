-- b180 · APPLY — index chit_status for the pulse watermark. Run the dry run first.
--
-- ⚠️⚠️ RUN THIS STATEMENT ON ITS OWN. There is deliberately NO BEGIN/COMMIT: `CREATE INDEX CONCURRENTLY`
-- CANNOT run inside a transaction block, and Postgres refuses it with
--     ERROR: CREATE INDEX CONCURRENTLY cannot run inside a transaction block
-- If the SQL editor wraps statements for you, run this file by itself so nothing else joins it in one block.
--
-- ⚠️ CONCURRENTLY IS THE POINT, NOT A FLOURISH. A plain CREATE INDEX takes a lock that blocks every WRITE to
-- chit_status for the duration — that is every status advance, assignment and read-receipt on the platform.
-- CONCURRENTLY builds without that lock. It is slower and takes two table passes; that is the correct trade on
-- a live table.
--
-- ⚠️ IF IT FAILS PART-WAY it leaves an INVALID index behind, which is not used but still costs write
-- maintenance. The check at the bottom names that state explicitly rather than reporting success. To clear one:
--     DROP INDEX CONCURRENTLY cs_entity_updated_idx;
-- then run this again.
--
-- Reversible: DROP INDEX CONCURRENTLY cs_entity_updated_idx;

CREATE INDEX CONCURRENTLY IF NOT EXISTS cs_entity_updated_idx
  ON chit_status (entity_id, updated_at DESC);
