-- b111: NETWORK DESIGN — per-entity persistence of the design-first Network builder draft (the node tree
-- + per-node capability specs / catalogue model). Replaces the browser-localStorage-only store so the SAME
-- design is visible across the user's machines and browsers. One design per entity (upsert on entity_id).
--
-- Isolation: WITH RLS. This holds an entity's private organisation design, so it is row-isolated exactly
-- like folder (b64) / chit_header (b49). App-`WHERE entity_id` alone is not the standard here.
-- Predicate matches b49/b64 exactly. Every route touching it runs inside withEntity() (see routes/network-design.js).
--
-- Rollback: DROP TABLE IF EXISTS network_design;

CREATE TABLE IF NOT EXISTS network_design (
  entity_id  uuid PRIMARY KEY REFERENCES identities(identity_id) ON DELETE CASCADE,   -- one design per entity; cascades if the entity is removed
  draft      jsonb NOT NULL DEFAULT '{}'::jsonb,     -- the whole UI.net draft (nodes + per-node catalogue model, etc.)
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE network_design ENABLE ROW LEVEL SECURITY;
ALTER TABLE network_design FORCE  ROW LEVEL SECURITY;
DROP POLICY IF EXISTS rls_entity ON network_design;
CREATE POLICY rls_entity ON network_design
  USING      (entity_id = NULLIF(current_setting('app.current_entity', true), '')::uuid)
  WITH CHECK (entity_id = NULLIF(current_setting('app.current_entity', true), '')::uuid);
