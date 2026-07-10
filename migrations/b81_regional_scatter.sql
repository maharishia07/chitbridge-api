-- b81: regional scatter (6a). Resolve a product's presentation + governance per customer REGION.
--   region_layer               = regional basics (currency/units/language/jurisdiction) = the auto-cascade layer.
--   container_region_override  = per-region deltas on a container (hybrid overrides: local names, compliance labels).
--   resolved_blueprint         = the SEALED immutable resolved view per (container, version, region) = resolve-at-mint,
--                                cache-forever (runtime just dereferences). INSERT-only (immutable).
-- All WITHOUT RLS (shared reference); override writes owner-gated app-side by the container owner.

CREATE TABLE IF NOT EXISTS region_layer (
  region_code   text PRIMARY KEY,
  currency      text,
  units         text,
  language      text,
  jurisdiction  jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE TABLE IF NOT EXISTS container_region_override (
  container_id  text NOT NULL,
  region_code   text NOT NULL,
  overrides     jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (container_id, region_code)
);

CREATE TABLE IF NOT EXISTS resolved_blueprint (
  container_id  text NOT NULL,
  version       integer NOT NULL,
  region_code   text NOT NULL,
  resolved      jsonb NOT NULL,
  sealed_at     timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (container_id, version, region_code)
);

INSERT INTO region_layer (region_code, currency, units, language, jurisdiction) VALUES
  ('IN','INR','litre','en','{"mode":"India","custodian":false,"disclaimer":"Provider, not custodian. Supplier jurisdiction applies."}'::jsonb),
  ('MX','MXN','litre','es','{"mode":"Mexico","custodian":false}'::jsonb),
  ('US','USD','gallon','en','{"mode":"United States","custodian":false}'::jsonb),
  ('EU','EUR','litre','en','{"mode":"EU","custodian":false,"compliance":"VOC labeling required"}'::jsonb)
ON CONFLICT (region_code) DO NOTHING;

DO $$ BEGIN IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='cb_app') THEN
  EXECUTE 'GRANT SELECT ON region_layer TO cb_app';
  EXECUTE 'GRANT SELECT,INSERT,UPDATE ON container_region_override TO cb_app';
  EXECUTE 'GRANT SELECT,INSERT ON resolved_blueprint TO cb_app';
END IF; END $$;
