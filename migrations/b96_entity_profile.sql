-- b96: per-entity TRADE PROFILE — makes Trade-ready INDIVIDUAL-specific. The entity declares its trade mode, markets,
-- sector(s), and ADOPTED voluntary certifications. Their required set = MANDATORY (derived, regulatory) ∪ ADOPTED
-- (voluntary, self-declared — e.g. ISO 9001). Example: a domestic-only general trader holding only ISO 9001 sees exactly
-- ISO 9001 and keeps only its artifacts. WITH RLS (owned data). See SPEC-entity-profile.md.

-- 1 · which standards are VOLUNTARY (opt-in) vs mandatory (regulatory, required when the lane demands it).
--     Management-system + eco-label certs are voluntary; regulatory clearances (REACH, SDS, HACCP, CE/RoHS…) are not.
ALTER TABLE standard_source ADD COLUMN IF NOT EXISTS voluntary boolean NOT NULL DEFAULT false;
UPDATE standard_source SET voluntary = true
  WHERE standard_key IN ('iso-9001','iso-14001','iso-27000','iso-45001','oeko-tex','gots');

-- 2 · the profile (one row per entity)
CREATE TABLE IF NOT EXISTS entity_profile (
  entity_id   uuid PRIMARY KEY,
  trade_mode  text   NOT NULL DEFAULT 'domestic',   -- 'domestic' | 'export'
  markets     text[] NOT NULL DEFAULT '{}',          -- destination dest_keys when exporting (EU/US/GULF…)
  sectors     text[] NOT NULL DEFAULT '{}',          -- verticals the entity operates in (paint/food/…)
  adopted     text[] NOT NULL DEFAULT '{}',          -- standard_keys the entity holds (voluntary certs it adopted)
  updated_at  timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE entity_profile ENABLE ROW LEVEL SECURITY;
CREATE POLICY rls_entity ON entity_profile
  USING      (entity_id = NULLIF(current_setting('app.current_entity', true), '')::uuid)
  WITH CHECK (entity_id = NULLIF(current_setting('app.current_entity', true), '')::uuid);
GRANT SELECT, INSERT, UPDATE ON entity_profile TO cb_app;
