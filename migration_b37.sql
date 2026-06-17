-- B3.7 — Customer Journey: public catalogue + end-customer order
-- Additive, backward-compatible. Safe to re-run.

-- CJ-01: catalogue visibility (private default / restricted / public)
ALTER TABLE entity_schemas
  ADD COLUMN IF NOT EXISTS visibility VARCHAR(20) NOT NULL DEFAULT 'private';
ALTER TABLE entity_schemas
  DROP CONSTRAINT IF EXISTS entity_schemas_visibility_chk;
ALTER TABLE entity_schemas
  ADD CONSTRAINT entity_schemas_visibility_chk
  CHECK (visibility IN ('private','restricted','public'));

-- CJ-08: owner_scope on identities (entity default | platform) — switch-ready, default entity
ALTER TABLE identities
  ADD COLUMN IF NOT EXISTS owner_scope VARCHAR(20) NOT NULL DEFAULT 'entity';
ALTER TABLE identities
  DROP CONSTRAINT IF EXISTS identities_owner_scope_chk;
ALTER TABLE identities
  ADD CONSTRAINT identities_owner_scope_chk
  CHECK (owner_scope IN ('entity','platform'));

-- end_customer identities are scoped under the shop via parent_entity_id (already exists)
CREATE INDEX IF NOT EXISTS idx_identities_parent ON identities(parent_entity_id);

-- Verify
SELECT 'public catalogues' AS t, COUNT(*) FROM entity_schemas WHERE visibility = 'public';
