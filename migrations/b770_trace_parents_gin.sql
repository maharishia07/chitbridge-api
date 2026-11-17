-- b770_trace_parents_gin.sql — K-DB / DB-58 + DB-59 (21 Oct 2026): a GIN index on chit_header's trace parents, for the forward trace walk.
--
-- ⚠️⚠️ DRAFT — NOT RUN · Athi runs it (Supabase SQL editor, AS postgres), ON ITS OWN: CREATE INDEX CONCURRENTLY cannot run inside a
--    transaction, so this file has no BEGIN/COMMIT and must not be pasted together with another file. Safe to re-run (IF NOT EXISTS).
--    Touches no rows; builds without locking chit_header against writes. If a run is interrupted it can leave an INVALID index: then
--    DROP INDEX CONCURRENTLY chit_header_trace_parents_gin; and run this again.
--
-- WHY: routes/chits.js traceForward (GET /chits/:id/trace, the recall / exposure walk) asks, once per depth, "which chits name any of
--    these as a parent": WHERE summary_json->'trace'->'parents' ?| $1::text[]. Without an index that is a full read of chit_header per
--    depth. The opclass is jsonb_ops, NOT jsonb_path_ops (the DB-58 backlog line): jsonb_path_ops serves only @> and the jsonpath
--    operators, and the query is ?| (any of these strings is an element), which only jsonb_ops serves.
-- RLS: unchanged (an index is not a policy; chit_header keeps FORCE RLS and its entity policies).

CREATE INDEX CONCURRENTLY IF NOT EXISTS chit_header_trace_parents_gin
  ON chit_header USING gin ((summary_json -> 'trace' -> 'parents') jsonb_ops);
