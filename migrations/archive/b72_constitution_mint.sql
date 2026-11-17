-- b72: the TOP RUNG — mint the CONSTITUTION the same way (b70 work_pattern · b71 capability). A constitution is a
-- minted, versioned, provenanced blueprint at the top: it GRANTS capabilities (the licensing/entitlement source) and
-- carries the universal governance. The ENTITY ADOPTS it (follows the active constitution), completing the lineage a
-- chit carries: constitution@v > capability@v > pattern@v. Shared reference data (one canonical row) — NO RLS. Idempotent.
BEGIN;

CREATE TABLE IF NOT EXISTS constitution (
  constitution_key text NOT NULL,
  version          text NOT NULL DEFAULT 'v1',
  label            text,
  vertical         text,                                 -- NULL = universal; a vertical constitution = its own row
  governance       jsonb NOT NULL DEFAULT '{}'::jsonb,   -- the universal sealed/open (defaults · allowed · tighten-only)
  capabilities     jsonb NOT NULL DEFAULT '[]'::jsonb,   -- the capabilities this constitution GRANTS (entitlement source)
  active           boolean NOT NULL DEFAULT true,
  minted_at        timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (constitution_key, version)
);
CREATE UNIQUE INDEX IF NOT EXISTS constitution_active_idx ON constitution(constitution_key) WHERE active = true;

-- MINT the base constitution@v1 — grants the core capabilities; carries the universal sealed rules.
INSERT INTO constitution (constitution_key, version, label, vertical, governance, capabilities) VALUES
  ('base', 'v1', 'Base constitution', NULL, '{
     "sealed": { "isolation": "per-copy", "no_orphans": true, "tighten_only": true },
     "open":   { "currency_code": "INR", "region": null }
   }'::jsonb, '["core","connector","dispute","workforce"]'::jsonb)
ON CONFLICT (constitution_key, version) DO UPDATE SET
  label = EXCLUDED.label, vertical = EXCLUDED.vertical,
  governance = EXCLUDED.governance, capabilities = EXCLUDED.capabilities, active = true;

DO $$ BEGIN IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='cb_app') THEN
  EXECUTE 'GRANT SELECT ON constitution TO cb_app';
END IF; END $$;

COMMIT;

-- ── PROOF ──────────────────────────────────────────────────────────────────────
-- the active constitution + what it grants:  SELECT constitution_key, version, capabilities FROM constitution WHERE active;
