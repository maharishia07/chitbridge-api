-- b60_blueprint_catalogue.sql — the LAST blueprint-mechanism migration. Turns blueprints into a governed
-- CATALOGUE with provenance:  SOURCE (a standard) -> TEMPLATE (derived outcome/requirement, many per source)
-- -> BLUEPRINT (assembled adoptable structure) -> minted INSTANCE. After this, adding a blueprint = a
-- register_blueprint() DATA call, NEVER a bespoke migration. Operationalizes the STANDARDS governance layer.
-- Spec: SPEC-blueprint-catalogue.md. Prereq: b55 (connector pack) + b59 (delivery pack + options-seeding).
-- Idempotent / re-runnable. Apply after b59.

BEGIN;

-- ===== ENGINE (mechanism — this is the migration-worthy part) =====

-- 1) SOURCE catalogue — the standards/authorities a blueprint derives from
CREATE TABLE IF NOT EXISTS blueprint_source (
  source_key   text PRIMARY KEY,
  label        text NOT NULL,
  authority    text,
  description  text,
  version      text,
  created_at   timestamptz NOT NULL DEFAULT now()
);

-- 2) TEMPLATE catalogue — outcomes/requirements derived from a source (many per source).
--    data_elements = the field fragments a template contributes; the derivation ("work in between") assembles them.
CREATE TABLE IF NOT EXISTS blueprint_template (
  template_key  text PRIMARY KEY,
  source_key    text NOT NULL REFERENCES blueprint_source(source_key),
  label         text NOT NULL,
  description   text,
  data_elements jsonb NOT NULL DEFAULT '[]'::jsonb,
  display_order int NOT NULL DEFAULT 0,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS bt_source_idx ON blueprint_template(source_key);

-- 3) BLUEPRINTS — add provenance + dependency declarations (the catalogue row schema)
ALTER TABLE blueprints ADD COLUMN IF NOT EXISTS source_key    text REFERENCES blueprint_source(source_key);
ALTER TABLE blueprints ADD COLUMN IF NOT EXISTS template_keys jsonb NOT NULL DEFAULT '[]'::jsonb;  -- which templates assembled it
ALTER TABLE blueprints ADD COLUMN IF NOT EXISTS requires      jsonb NOT NULL DEFAULT '[]'::jsonb;  -- engine/schema prereqs
ALTER TABLE blueprints ADD COLUMN IF NOT EXISTS prerequisites jsonb NOT NULL DEFAULT '[]'::jsonb;  -- capability/plan deps
ALTER TABLE blueprints ADD COLUMN IF NOT EXISTS provides      jsonb NOT NULL DEFAULT '[]'::jsonb;  -- add-on capabilities granted
ALTER TABLE blueprints ADD COLUMN IF NOT EXISTS version       text NOT NULL DEFAULT 'v1';

DO $$ BEGIN IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='cb_app') THEN
  EXECUTE 'GRANT SELECT,INSERT,UPDATE,DELETE ON blueprint_source TO cb_app';
  EXECUTE 'GRANT SELECT,INSERT,UPDATE,DELETE ON blueprint_template TO cb_app';
END IF; END $$;

-- 4) The governed REGISTRATION PATH — add/curate a blueprint as DATA (one call), not a migration.
CREATE OR REPLACE FUNCTION register_blueprint(
  p_key text, p_label text, p_source text, p_templates jsonb, p_pack jsonb,
  p_requires jsonb DEFAULT '[]'::jsonb, p_prerequisites jsonb DEFAULT '[]'::jsonb,
  p_provides jsonb DEFAULT '[]'::jsonb, p_version text DEFAULT 'v1')
RETURNS void LANGUAGE sql AS $fn$
  INSERT INTO blueprints (blueprint_key,label,pack,source_key,template_keys,requires,prerequisites,provides,version,active)
  VALUES (p_key,p_label,p_pack,p_source,p_templates,p_requires,p_prerequisites,p_provides,p_version,true)
  ON CONFLICT (blueprint_key) DO UPDATE SET
    label=EXCLUDED.label, pack=EXCLUDED.pack, source_key=EXCLUDED.source_key, template_keys=EXCLUDED.template_keys,
    requires=EXCLUDED.requires, prerequisites=EXCLUDED.prerequisites, provides=EXCLUDED.provides,
    version=EXCLUDED.version, updated_at=now();
$fn$;

-- ===== DATA (the catalogue content — what used to be a migration each, now just rows) =====

-- 5) SOURCES — the STANDARDS layer, as data. CMMI = the worked example; iot-telemetry proves generality.
INSERT INTO blueprint_source (source_key,label,authority,description,version) VALUES
  ('cmmi','CMMI — Capability Maturity Model Integration','CMMI Institute (ISACA)','Process-maturity standard; levels L1..L5','2.0'),
  ('iot-telemetry','IoT Device Telemetry','Device standard (internal)','A device emits signals (device_id, signal, value, unit) over a transport','v1')
ON CONFLICT (source_key) DO UPDATE SET label=EXCLUDED.label, authority=EXCLUDED.authority, description=EXCLUDED.description, version=EXCLUDED.version;

-- 6) TEMPLATES derived from CMMI = the 5 maturity levels (the requirement scale the blueprint adopts).
INSERT INTO blueprint_template (template_key,source_key,label,description,data_elements,display_order) VALUES
  ('cmmi-l1','cmmi','L1 Initial','Ad-hoc; proven once','[]'::jsonb,1),
  ('cmmi-l2','cmmi','L2 Managed','Repeatable; packaged','[]'::jsonb,2),
  ('cmmi-l3','cmmi','L3 Defined','Standardised; itemised','[]'::jsonb,3),
  ('cmmi-l4','cmmi','L4 Quantitatively Managed','Measured; governed','[]'::jsonb,4),
  ('cmmi-l5','cmmi','L5 Optimizing','Continuous; productized','[]'::jsonb,5),
  ('iot-signal','iot-telemetry','Device Signal','Telemetry data-element set',
    '[{"name":"Device ID","key":"device_id","type":"text"},{"name":"Signal","key":"signal","type":"text"},{"name":"Value","key":"value","type":"number"},{"name":"Unit","key":"unit","type":"text"}]'::jsonb,1)
ON CONFLICT (template_key) DO UPDATE SET label=EXCLUDED.label, description=EXCLUDED.description, data_elements=EXCLUDED.data_elements, display_order=EXCLUDED.display_order;

-- 7) MOVE the existing blueprints INTO the catalogue (was a migration each; now DATA rows with provenance).
--    Packs reused from their prior registration (b55 connector / b59 delivery) — this ENRICHES with source/deps.

-- delivery-lifecycle  <-  CMMI, assembled from the 5 level templates (its maturity scale = these templates)
SELECT register_blueprint(
  'delivery-lifecycle','Product / Capability Delivery Lifecycle','cmmi',
  '["cmmi-l1","cmmi-l2","cmmi-l3","cmmi-l4","cmmi-l5"]'::jsonb,
  COALESCE((SELECT pack FROM blueprints WHERE blueprint_key='delivery-lifecycle'), '{}'::jsonb),
  '["create_from_blueprint options-seeding (b59)"]'::jsonb,   -- requires
  '[]'::jsonb, '[]'::jsonb, 'v1');

-- connector  <-  IoT telemetry, from the device-signal template; needs the connector runtime
SELECT register_blueprint(
  'connector','Connector / IoT Device','iot-telemetry',
  '["iot-signal"]'::jsonb,
  COALESCE((SELECT pack FROM blueprints WHERE blueprint_key='connector'), '{}'::jsonb),
  '["connector_connection table (b57)","routes/connectors.js"]'::jsonb,  -- requires
  '["connector capability"]'::jsonb,                                     -- prerequisites
  '[]'::jsonb, 'v1');

COMMIT;

-- ── PROOF ──────────────────────────────────────────────────────────────────────
-- STANDARDS layer as data (sources):        SELECT * FROM blueprint_source;
-- CMMI -> its templates:                    SELECT template_key,label FROM blueprint_template WHERE source_key='cmmi' ORDER BY display_order;
-- catalogue with provenance:                SELECT blueprint_key,source_key,template_keys,requires,prerequisites FROM blueprints ORDER BY blueprint_key;
-- ADD A NEW BLUEPRINT WITH NO MIGRATION (the whole point):
--   SELECT register_blueprint('iso27001','ISO 27001 ISMS','<a source_key>', '["..."]'::jsonb, '{"schema_name":"Control","fields":[...]}'::jsonb);
