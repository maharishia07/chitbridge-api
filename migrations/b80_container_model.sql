-- b80: container model. product_container = mutable pointer; product_version = immutable write-once versions.
-- Both WITHOUT RLS (shared reference, like catalogue_source); writes gated app-side by owner_entity_id.

CREATE TABLE IF NOT EXISTS product_container (
  container_id     text PRIMARY KEY,
  owner_entity_id  uuid,
  source_key       text,
  name             text,
  current_version  integer NOT NULL DEFAULT 1,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS product_version (
  container_id     text NOT NULL,
  version          integer NOT NULL,
  content          jsonb NOT NULL DEFAULT '{}'::jsonb,
  schema           jsonb NOT NULL DEFAULT '{}'::jsonb,
  schema_version   text,
  minted_at        timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (container_id, version)
);

CREATE INDEX IF NOT EXISTS idx_product_container_owner ON product_container (owner_entity_id);

DO $$ BEGIN IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='cb_app') THEN
  EXECUTE 'GRANT SELECT,INSERT,UPDATE ON product_container TO cb_app';
  EXECUTE 'GRANT SELECT,INSERT ON product_version TO cb_app';
END IF; END $$;
