-- b910_chit_summary_period_index.sql — an index for the till-summary read (LV speed-counter-01 F4, batch 1129).
--
-- ⚠️ NOT RUN · Athi runs it (Supabase SQL editor, AS postgres), SIT first. Safe to repeat (IF NOT EXISTS). CONCURRENTLY: run it ALONE, not inside a transaction block (the SQL editor
--      must send it as its own statement); a failed run leaves an INVALID index of this name: DROP INDEX CONCURRENTLY it and run again.
-- WHY  lib/till-summary.js SUMMARY_SQL (GET /api/till/summary, GET /api/facts/till, Reports › Trend) filters  entity_id + purpose='general' + business_json->'summary'->>'period'  and orders by
--      business_json->'summary'->>'key' DESC, created_at DESC. No index holds those expressions, so each read walks the shop's chit copies. This one holds exactly the rows that carry a summary.
-- WHAT one partial expression index on chit_header (entity_id, period, key DESC, created_at DESC) WHERE the row has a summary period. It serves the statement's WHERE and ORDER BY as written (same
--      expressions, same text); no column, constraint or row changes. The number is the batch's next free one (b907, b908 are taken in the 1129 batch); b909 is taken by F13 (RUN-2026-11-22-b909-identities-creator-narrow), so this is b910.
-- ORDER any time. RLS: untouched (an index; chit_header keeps its FORCE RLS policy).
-- ROLL BACK: DROP INDEX CONCURRENTLY IF EXISTS chit_header_summary_period_idx;
-- CHECK (read-only): SELECT indexname, indisvalid FROM pg_indexes i JOIN pg_class c ON c.relname = i.indexname JOIN pg_index x ON x.indexrelid = c.oid WHERE i.indexname = 'chit_header_summary_period_idx';   (1 row, indisvalid = t)
--        and:  EXPLAIN SELECT chit_id FROM chit_header WHERE entity_id = '<a shop>' AND purpose = 'general' AND business_json -> 'summary' ->> 'period' = 'day' ORDER BY business_json -> 'summary' ->> 'key' DESC, created_at DESC LIMIT 840;
--        (the plan names chit_header_summary_period_idx on a shop with many chits; a small table may still choose a scan, which is right).
CREATE INDEX CONCURRENTLY IF NOT EXISTS chit_header_summary_period_idx
  ON chit_header (entity_id, (business_json -> 'summary' ->> 'period'), (business_json -> 'summary' ->> 'key') DESC, created_at DESC)
  WHERE purpose = 'general' AND business_json -> 'summary' ->> 'period' IS NOT NULL;
