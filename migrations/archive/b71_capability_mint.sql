-- b71: the MIDDLE RUNG — mint CAPABILITIES the same way work-patterns are minted (b70). A capability is a minted,
-- versioned, provenanced blueprint that an ENTITY ADOPTS (via identities.capabilities) and that CONTAINS work patterns.
-- The seam resolves a work pattern's PARENT capability so a chit records its full lineage: capability@v > pattern@v.
-- Shared reference data (one canonical row per capability@version) — NOT per-entity, so NO RLS. Idempotent.
-- Prereq: b70 (work_pattern).
BEGIN;

CREATE TABLE IF NOT EXISTS capability (
  capability_key text NOT NULL,
  version        text NOT NULL DEFAULT 'v1',
  label          text,
  vertical       text,                                  -- the vertical this targets (NULL = universal)
  source_key     text,                                  -- provenance: the standard it derives from
  governance     jsonb NOT NULL DEFAULT '{}'::jsonb,    -- the capability's own sealed · open · lifecycle
  work_patterns  jsonb NOT NULL DEFAULT '[]'::jsonb,    -- the work patterns this capability CONTAINS
  active         boolean NOT NULL DEFAULT true,
  minted_at      timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (capability_key, version)
);
CREATE UNIQUE INDEX IF NOT EXISTS capability_active_idx ON capability(capability_key) WHERE active = true;

-- MINT the connector capability@v1 — contains the iot-signal (and erp-document) work patterns.
INSERT INTO capability (capability_key, version, label, source_key, governance, work_patterns) VALUES
  ('connector', 'v1', 'Connector — IoT / ERP', 'iot-telemetry', '{
     "sealed": { "isolation": "per-copy", "lifecycle": ["adopt","enable","configure","active"] },
     "open":   { "max_devices": 25 }
   }'::jsonb, '["iot-signal","erp-document"]'::jsonb)
ON CONFLICT (capability_key, version) DO UPDATE SET
  label = EXCLUDED.label, source_key = EXCLUDED.source_key,
  governance = EXCLUDED.governance, work_patterns = EXCLUDED.work_patterns, active = true;

-- the PARENT pointer: each work pattern knows which capability contains it.
ALTER TABLE work_pattern ADD COLUMN IF NOT EXISTS capability_key text;
UPDATE work_pattern SET capability_key = 'connector' WHERE pattern_key = 'iot-signal';

DO $$ BEGIN IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='cb_app') THEN
  EXECUTE 'GRANT SELECT ON capability TO cb_app';
END IF; END $$;

COMMIT;

-- ── PROOF ──────────────────────────────────────────────────────────────────────
-- minted capability + what it contains:  SELECT capability_key, version, work_patterns FROM capability;
-- a work pattern's parent capability:     SELECT pattern_key, capability_key FROM work_pattern;
