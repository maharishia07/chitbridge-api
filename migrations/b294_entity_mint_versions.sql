-- b294_entity_mint_versions.sql — what an entity was minted FROM, and on which version (the CB Sides panel, "We lean on").
--
-- Athi, 2026-10-08/09: the shell gets two reference panels. The left one shows, for each thing the business leans on, its version and
-- whether the business was minted on an OLDER one ("waiting change", drift). The constitution (entity_governance.constitution_version)
-- and brand sources (catalogue_adoption.version) already keep the version at mint. The boilerplate and the blueprint do NOT:
-- entity_governance holds only boilerplate_key (b88). Without the version at mint their drift cannot be told, so the panel shows those
-- rows as "not yet". This file adds the columns; lib/sides.js reads them the moment they exist (it probes the columns first).
--
-- ── WHAT THIS DOES NOT DO ────────────────────────────────────────────────
--   It only ADDS three nullable columns. NOTHING writes them yet: the mint path (routes/signin.js, governance/mint.js) must stamp
--   boilerplate_version / blueprint_key / blueprint_version when it clones — a separate, deliberate change. Until then the rows stay
--   "not yet", which is the truth. Existing rows are untouched (NULL = never recorded; the panel never reads NULL as "Current").
--
-- ── RLS ──────────────────────────────────────────────────────────────────
--   entity_governance is FORCE ROW LEVEL SECURITY (b73). ADD COLUMN does not touch policies; the existing rls_entity policy covers the
--   new columns. No grant change.
--
-- ── RUN ORDER ────────────────────────────────────────────────────────────
--   Run once, any time (idempotent). The API works before and after it (deploy-before-migration safe).

ALTER TABLE entity_governance ADD COLUMN IF NOT EXISTS boilerplate_version text;
ALTER TABLE entity_governance ADD COLUMN IF NOT EXISTS blueprint_key       text;
ALTER TABLE entity_governance ADD COLUMN IF NOT EXISTS blueprint_version   text;

-- check (read-only): the columns are there
SELECT column_name FROM information_schema.columns
 WHERE table_schema = 'public' AND table_name = 'entity_governance'
   AND column_name IN ('boilerplate_key', 'boilerplate_version', 'blueprint_key', 'blueprint_version') ORDER BY 1;
