-- b99: METERING LEDGER + PREPAID WALLET (general — AI is just the first meter).
-- The platform-shared resources (AI key, and every licensed/limited capability) all bill the SAME way:
--   • usage_ledger  — one row per billable event: entity · meter · quantity · cost. AI drafts write meter='ai.draft';
--     the identical row later meters chit.send, network.connect, iot.task, erp.transfer, extra co-assists, ...
--   • entity_wallet — prepaid CREDITS an entity tops up. BALANCE = credits_usd − Σ(usage_ledger.cost_usd).
--     Every metered event "subtracts" because balance is the running difference (auditable, no race on a mutable column).
-- WITH RLS: an entity sees only its own ledger + wallet. Metering only — ENFORCEMENT (block on empty wallet) is a
-- separate, careful step (see project-entitlement-limits): drafting still works before this runs (logging is best-effort).

CREATE TABLE IF NOT EXISTS usage_ledger (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_id   uuid NOT NULL,
  meter       text NOT NULL,                       -- 'ai.draft', 'chit.send', 'network.connect', 'iot.task', ...
  detail      text,                                -- e.g. doc_type (AI), counterparty, task id
  quantity    numeric(18,4) NOT NULL DEFAULT 1,    -- tokens / count / units for this meter
  cost_usd    numeric(12,6) NOT NULL DEFAULT 0,    -- the DEBIT
  meta        jsonb,                               -- {model, input_tokens, output_tokens, ...}
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS usage_ledger_entity_meter ON usage_ledger (entity_id, meter);
ALTER TABLE usage_ledger ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS rls_entity ON usage_ledger;
CREATE POLICY rls_entity ON usage_ledger
  USING      (entity_id = NULLIF(current_setting('app.current_entity', true), '')::uuid)
  WITH CHECK (entity_id = NULLIF(current_setting('app.current_entity', true), '')::uuid);
GRANT SELECT, INSERT ON usage_ledger TO cb_app;

CREATE TABLE IF NOT EXISTS entity_wallet (
  entity_id    uuid PRIMARY KEY,
  credits_usd  numeric(12,4) NOT NULL DEFAULT 0,   -- sum of prepaid top-ups
  updated_at   timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE entity_wallet ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS rls_entity ON entity_wallet;
CREATE POLICY rls_entity ON entity_wallet
  USING      (entity_id = NULLIF(current_setting('app.current_entity', true), '')::uuid)
  WITH CHECK (entity_id = NULLIF(current_setting('app.current_entity', true), '')::uuid);
GRANT SELECT, INSERT, UPDATE ON entity_wallet TO cb_app;
