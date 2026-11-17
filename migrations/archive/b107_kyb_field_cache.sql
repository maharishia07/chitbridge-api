-- b107: KYB field-search cache (Section 4 idempotent billing — same entity + same profile within the window → free).
-- Per-entity, WITH RLS (the platform's isolation standard). Additive + self-healing: lib/kyb self-heals (uncached) until run.
CREATE TABLE IF NOT EXISTS kyb_field_cache (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_id    uuid NOT NULL,
  profile_hash text NOT NULL,            -- sha256 of the entity's profile (sectors/markets/adopted/mode)
  result       jsonb NOT NULL,           -- the walled-off field result (markets/demand/paths — never buyers)
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS kyb_field_cache_lookup ON kyb_field_cache (entity_id, profile_hash, created_at DESC);
ALTER TABLE kyb_field_cache ENABLE ROW LEVEL SECURITY;
ALTER TABLE kyb_field_cache FORCE  ROW LEVEL SECURITY;
DROP POLICY IF EXISTS rls_entity ON kyb_field_cache;
CREATE POLICY rls_entity ON kyb_field_cache
  USING      (entity_id = NULLIF(current_setting('app.current_entity', true), '')::uuid)
  WITH CHECK (entity_id = NULLIF(current_setting('app.current_entity', true), '')::uuid);
GRANT SELECT, INSERT ON kyb_field_cache TO cb_app;
