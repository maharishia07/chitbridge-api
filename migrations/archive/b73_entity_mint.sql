-- b73: PER-ENTITY / VERTICAL minting. Two moves that complete the fractal:
--   1) a VERTICAL is just another minted constitution row (add one = a new vertical/domain, no code).
--   2) an ENTITY is MINTED with its OWN stamp — entity_governance says which constitution@version governs IT.
-- The seam then resolves the ENTITY'S constitution (its stamp) → falls back to the DEFAULT (base) if unstamped. So a
-- chit's governed.constitution reflects the entity's OWN vertical. entity_governance is per-entity → WITH RLS.
-- Prereq: b72 (constitution). Idempotent.
BEGIN;

-- one designated DEFAULT constitution (the fallback for unstamped entities)
ALTER TABLE constitution ADD COLUMN IF NOT EXISTS is_default boolean NOT NULL DEFAULT false;
UPDATE constitution SET is_default = true WHERE constitution_key = 'base';

-- A VERTICAL = a minted constitution. Adding a domain (service desk, pharma, logistics...) is THIS one row.
INSERT INTO constitution (constitution_key, version, label, vertical, is_default, governance, capabilities) VALUES
  ('service-desk', 'v1', 'Service Desk vertical', 'service-desk', false, '{
     "sealed": { "isolation": "per-copy", "no_orphans": true, "tighten_only": true, "sla": "itil" },
     "open":   { "currency_code": "INR", "region": null }
   }'::jsonb, '["core","connector","dispute","workforce"]'::jsonb)
ON CONFLICT (constitution_key, version) DO UPDATE SET
  label = EXCLUDED.label, vertical = EXCLUDED.vertical, is_default = EXCLUDED.is_default,
  governance = EXCLUDED.governance, capabilities = EXCLUDED.capabilities, active = true;

-- The ENTITY MINT STAMP — per-entity: which constitution@version governs this entity. WITH RLS (per-entity data).
CREATE TABLE IF NOT EXISTS entity_governance (
  entity_id            uuid PRIMARY KEY,
  constitution_key     text NOT NULL,
  constitution_version text NOT NULL DEFAULT 'v1',
  minted_at            timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE entity_governance ENABLE ROW LEVEL SECURITY;
ALTER TABLE entity_governance FORCE  ROW LEVEL SECURITY;
DROP POLICY IF EXISTS rls_entity ON entity_governance;
CREATE POLICY rls_entity ON entity_governance
  USING      (entity_id = NULLIF(current_setting('app.current_entity', true), '')::uuid)
  WITH CHECK (entity_id = NULLIF(current_setting('app.current_entity', true), '')::uuid);
GRANT SELECT, INSERT, UPDATE, DELETE ON entity_governance TO cb_app;

-- MINT a demo entity onto the vertical: Beta Traders -> service-desk@v1 (proves per-entity/vertical resolution).
-- Alpha stays UNstamped -> falls back to base@v1. (Run as admin/postgres, which bypasses RLS for this seed.)
INSERT INTO entity_governance (entity_id, constitution_key, constitution_version) VALUES
  ('75c378a6-ad7f-4b58-87d2-e1509cbb0482', 'service-desk', 'v1')
ON CONFLICT (entity_id) DO UPDATE SET constitution_key = EXCLUDED.constitution_key, constitution_version = EXCLUDED.constitution_version, minted_at = now();

COMMIT;

-- ── PROOF ──────────────────────────────────────────────────────────────────────
-- verticals available:      SELECT constitution_key, version, vertical, is_default FROM constitution ORDER BY constitution_key;
-- an entity's mint stamp:    (as that entity) SELECT * FROM entity_governance;
