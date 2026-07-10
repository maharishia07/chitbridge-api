-- b80: CONTAINER MODEL (see C:\dev\SPEC-source-governed-distribution.md §7b) — the reference layer as a MUTABLE
-- POINTER over IMMUTABLE VERSIONS (git tag→commit / Docker tag→digest pattern).
--   product_container = a STABLE product identity that points to its CURRENT version (the pointer MOVES on enhancement).
--   product_version   = IMMUTABLE, write-once {content, schema} per version — NEVER updated (so a chit that pinned a
--                       version verifies EXACTLY what the customer saw). Immutability is enforced by the GRANT below
--                       (cb_app gets SELECT,INSERT only — no UPDATE/DELETE on product_version).
-- Both WITHOUT RLS (shared reference, like catalogue_source); WRITES gated app-side by owner_entity_id.

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
  content          jsonb NOT NULL DEFAULT '{}'::jsonb,   -- attributes + visuals + experience (immutable)
  schema           jsonb NOT NULL DEFAULT '{}'::jsonb,   -- the fields shape (immutable)
  schema_version   text,
  minted_at        timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (container_id, version)
);
CREATE INDEX IF NOT EXISTS idx_product_container_owner ON product_container (owner_entity_id);

DO $$ BEGIN IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='cb_app') THEN
  EXECUTE 'GRANT SELECT,INSERT,UPDATE ON product_container TO cb_app';   -- pointer moves (UPDATE current_version)
  EXECUTE 'GRANT SELECT,INSERT ON product_version TO cb_app';            -- IMMUTABLE: no UPDATE/DELETE by design
END IF; END $$;

-- Rollback (optional): DROP TABLE IF EXISTS product_version; DROP TABLE IF EXISTS product_container;
