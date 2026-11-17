-- b112: CATALOGUE FACE — per-entity persistence of the catalogue setup "face" (purpose · storefront method ·
-- units · facets · tax · ERP mapping — the catalogue-level config). Replaces the browser-localStorage-only store
-- so the SAME setup follows the user across machines/browsers. One face per entity (upsert on entity_id).
-- The catalogue ITEMS themselves live in catalogue_items (real products, already RLS) — this holds only the face.
--
-- Isolation: WITH RLS. This is an entity's private catalogue configuration, row-isolated exactly like
-- network_design (b111) / folder (b64) / chit_header (b49). App-`WHERE entity_id` alone is not the standard here.
-- Predicate matches b49/b64/b111 exactly. Every route touching it runs inside withEntity() (see routes/catalogue-face.js).
--
-- Rollback: DROP TABLE IF EXISTS catalogue_face;

CREATE TABLE IF NOT EXISTS catalogue_face (
  entity_id  uuid PRIMARY KEY REFERENCES identities(identity_id) ON DELETE CASCADE,   -- one face per entity; cascades if the entity is removed
  face       jsonb NOT NULL DEFAULT '{}'::jsonb,     -- the whole UI.catf config (method · units · facets · tax · erpMap · catalogue)
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE catalogue_face ENABLE ROW LEVEL SECURITY;
ALTER TABLE catalogue_face FORCE  ROW LEVEL SECURITY;
DROP POLICY IF EXISTS rls_entity ON catalogue_face;
CREATE POLICY rls_entity ON catalogue_face
  USING      (entity_id = NULLIF(current_setting('app.current_entity', true), '')::uuid)
  WITH CHECK (entity_id = NULLIF(current_setting('app.current_entity', true), '')::uuid);
