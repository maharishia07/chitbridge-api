-- b106: ONE performance index (checked against the existing schema — everything else is already well-indexed).
-- The wallet-gate's GLOBAL daily-spend SUM (ai_global_spend_today) filters `meter='ai.draft' AND created_at >= today`
-- with NO entity_id, so the existing (entity_id, meter) index can't serve it. As usage_ledger grows this SUM would
-- slow the pre-flight of every AI call. A partial index on created_at (only the ai.draft rows) keeps it a tiny range scan.
-- Deliberately NOT adding others: chit_status / chit_disputes / chit_messages / entity_compliance(PK) / capture / wallet
-- are already covered by existing indexes/PKs — adding more would only slow writes (the 12-index lesson).
-- Idempotent + additive. For a large live table, run CREATE INDEX CONCURRENTLY outside a transaction instead.
CREATE INDEX IF NOT EXISTS usage_ledger_ai_day ON usage_ledger (created_at) WHERE meter = 'ai.draft';
