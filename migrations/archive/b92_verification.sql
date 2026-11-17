-- b92: the VERIFICATION stamp on a gathered clearance — the trust ladder (declared→documented→attested→verified).
-- entity_compliance already exists (b90, WITH RLS). We add a `verification` jsonb holding HOW it was verified:
--   {} / absent          → declared or documented (derived from evidence_ref: a chit_id = documented, else declared)
--   {method:'registry'}  → VERIFIED  (machine-checked against a source registry — un-fakeable)
--   {method:'attested'}  → ATTESTED  (a trusted party vouched — the on-rail attestor, later phase)
ALTER TABLE entity_compliance ADD COLUMN IF NOT EXISTS verification jsonb NOT NULL DEFAULT '{}'::jsonb;
