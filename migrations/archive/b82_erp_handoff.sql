-- b82: ERP handoff (6b) — receipt-only, process-then-forget. When an order is placed, CB records a RECEIPT of handing
-- the order + its governance (source@v, container refs, routing policy, locality) to the distributor's ERP. Stores
-- refs + a hash, NOT the raw payload. CB does NOT route/fulfill (the ERP does). This is where CB stops at the info.
-- Per-DISTRIBUTOR owned data => WITH RLS (b49 pattern: entity_id = app.current_entity).

CREATE TABLE IF NOT EXISTS erp_handoff (
  handoff_id    uuid PRIMARY KEY,
  entity_id     uuid NOT NULL,
  chit_id       uuid,
  summary       jsonb NOT NULL DEFAULT '{}'::jsonb,
  payload_hash  text,
  status        text NOT NULL DEFAULT 'handed_off',
  created_at    timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE erp_handoff ENABLE ROW LEVEL SECURITY;
ALTER TABLE erp_handoff FORCE  ROW LEVEL SECURITY;
DROP POLICY IF EXISTS rls_entity ON erp_handoff;
CREATE POLICY rls_entity ON erp_handoff
  USING      (entity_id = NULLIF(current_setting('app.current_entity', true), '')::uuid)
  WITH CHECK (entity_id = NULLIF(current_setting('app.current_entity', true), '')::uuid);

DO $$ BEGIN IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='cb_app') THEN
  EXECUTE 'GRANT SELECT,INSERT ON erp_handoff TO cb_app';
END IF; END $$;
