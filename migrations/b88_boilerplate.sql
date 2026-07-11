-- b88: THE BOILERPLATE-DECLARES-ITS-SOURCES keystone (DDL layer of the entity lifecycle).
-- A boilerplate is the sealed MOULD: it DECLARES which sources it inherits (not "all active standards") + binds locale.
-- Entities minted from it resolve THEIR boilerplate's declared sources. Also renames ISO 9000 → ISO 9001 (the
-- certifiable standard) with facet 'quality'. Shared-reference class (WITHOUT RLS, GRANT SELECT), like standard_source.
-- See C:\dev\SPEC-ddl-dml-lifecycle.md.

-- 1 · ISO 9000 → ISO 9001 (facet quality). standard_key is a PK column but nothing FKs it (chit stamps are string
--     snapshots, kept as-is for audit). Idempotent: rename if present, else ensure the 9001 row exists.
UPDATE standard_source SET standard_key = 'iso-9001', title = 'ISO 9001 — Quality management', facet = 'quality'
  WHERE standard_key = 'iso-9000';
INSERT INTO standard_source (standard_key, version, title, facet, template) VALUES
 ('iso-9001', 'v1', 'ISO 9001 — Quality management', 'quality',
  '{"required":["quality_manual","document_control","internal_audit","management_review","corrective_action"],"scope":"entity","audit_cycle":"annual"}'::jsonb)
ON CONFLICT (standard_key, version) DO NOTHING;

-- 2 · the boilerplate (the sealed mould) + its DECLARED sources
CREATE TABLE IF NOT EXISTS boilerplate (
  boilerplate_key text        NOT NULL,
  version         text        NOT NULL DEFAULT 'v1',
  label           text,
  region_code     text,                                   -- links region_layer (b81) for currency/units/jurisdiction
  locale          jsonb       NOT NULL DEFAULT '{}'::jsonb,-- {currency, tz, jurisdiction} — bound at definition
  sealed          boolean     NOT NULL DEFAULT true,
  active          boolean     NOT NULL DEFAULT true,
  minted_at       timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (boilerplate_key, version)
);
CREATE TABLE IF NOT EXISTS boilerplate_sources (
  boilerplate_key text NOT NULL,
  version         text NOT NULL DEFAULT 'v1',
  source_key      text NOT NULL,                          -- e.g. beta-royale-play@v1 / iso-9001 / exim-policy
  source_kind     text NOT NULL DEFAULT 'standard',       -- 'brand' | 'standard'
  facet           text,                                   -- for standards: quality / trade / ...
  PRIMARY KEY (boilerplate_key, version, source_key)
);

-- 3 · an entity records WHICH boilerplate it was minted from (per-entity governance stamp, b73)
ALTER TABLE entity_governance ADD COLUMN IF NOT EXISTS boilerplate_key text;

-- 4 · seed the demo mould: RoyalePlay BP — India, inheriting the three sources + India locale
INSERT INTO boilerplate (boilerplate_key, version, label, region_code, locale) VALUES
 ('royaleplay-bp-india', 'v1', 'RoyalePlay BP — India', 'IN',
  '{"currency":"INR","tz":"Asia/Kolkata","jurisdiction":"IN"}'::jsonb)
ON CONFLICT (boilerplate_key, version) DO NOTHING;
INSERT INTO boilerplate_sources (boilerplate_key, version, source_key, source_kind, facet) VALUES
 ('royaleplay-bp-india', 'v1', 'beta-royale-play@v1', 'brand',    NULL),
 ('royaleplay-bp-india', 'v1', 'iso-9001',            'standard', 'quality'),
 ('royaleplay-bp-india', 'v1', 'exim-policy',         'standard', 'trade')
ON CONFLICT (boilerplate_key, version, source_key) DO NOTHING;

-- 5 · shared-reference reads for the app role
DO $$ BEGIN IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='cb_app') THEN
  EXECUTE 'GRANT SELECT ON boilerplate TO cb_app';
  EXECUTE 'GRANT SELECT ON boilerplate_sources TO cb_app';
END IF; END $$;
