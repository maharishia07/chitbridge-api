-- b89: standards become SOURCE-ENTITIES (stable identity + mutable name) — mirrors b78 (catalogue source owned by an
-- entity). The standard CONTENT stays in the typed standard_source (its template = the required-capture fields); it is
-- now OWNED by a SEALED entity that gives it a STABLE identity_id + a MUTABLE display_name. So renaming a standard is a
-- one-field change (display_name), never an identity change → the loose-coupling #1 fix. The entities are sealed →
-- protected by P0-1 (guards + b86 trigger). See C:\dev\SPEC-ddl-dml-lifecycle.md, [[feedback-loose-until-stamped]].

-- 1 · the owning source-entity link on the standard content (like catalogue_source.owner_entity_id, b78)
ALTER TABLE standard_source ADD COLUMN IF NOT EXISTS owner_entity_id uuid;

-- 2 · a sealed source-entity per existing standard (idempotent by a deterministic .local email). display_name is the
--     MUTABLE human name; bridge_id + identity_id are the STABLE handles everything references.
INSERT INTO identities (bridge_id, display_name, email, identity_type, status, sealed, owner_scope)
VALUES ('CBSRCISO91', 'ISO 9001 — Quality management', 'src.iso-9001@chitbridge.local', 'entity', 'active', true, 'platform')
ON CONFLICT (email) DO NOTHING;
INSERT INTO identities (bridge_id, display_name, email, identity_type, status, sealed, owner_scope)
VALUES ('CBSRCEXIM1', 'EXIM — Foreign Trade policy', 'src.exim-policy@chitbridge.local', 'entity', 'active', true, 'platform')
ON CONFLICT (email) DO NOTHING;

-- 3 · link each standard's content to its owning source-entity
UPDATE standard_source s SET owner_entity_id = i.identity_id
  FROM identities i WHERE i.email = 'src.iso-9001@chitbridge.local'  AND s.standard_key = 'iso-9001'    AND s.owner_entity_id IS NULL;
UPDATE standard_source s SET owner_entity_id = i.identity_id
  FROM identities i WHERE i.email = 'src.exim-policy@chitbridge.local' AND s.standard_key = 'exim-policy' AND s.owner_entity_id IS NULL;

-- 4 · the register-a-source endpoint needs to write standard content (it already only had SELECT, b85)
DO $$ BEGIN IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='cb_app') THEN
  EXECUTE 'GRANT INSERT,UPDATE ON standard_source TO cb_app';
END IF; END $$;
