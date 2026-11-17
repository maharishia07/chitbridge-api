-- b299_country_setup.sql — CS1 (2026-10-12): COUNTRY SETUP after registration — the entity's governance profile holds the
--   financial-year start, the tax registration, where each answer came from, and WHEN the owner completed the step. NO new table.
--
-- ⚠️⚠️ DRAFT — NOT RUN · Athi runs it (Supabase SQL editor, AS postgres — ALTER TABLE needs the table owner, cb_app cannot).
--    Written offline, read, never executed. Safe to re-run (every statement is IF NOT EXISTS / guarded; the backfill is idempotent).
--    Until it runs: GET /api/governance/country-setup answers migrated:false (the identities facts, the pack's own year),
--    PUT answers 503 COUNTRY_SETUP_NOT_MIGRATED in words, and the books gate refuses ONLY a country with no pack
--    (identities.country decides) — a shop that was fine yesterday is fine today. Never a 500.
--
-- RLS: WITHOUT any new policy — entity_governance already carries rls_entity (b73: USING / WITH CHECK entity_id =
--    app.current_entity). New columns inherit it; a shop reads and writes only its own row. identities is untouched in shape.
--
-- WHAT (DECISIONS 2026-10-03 "Country packs: the three switch decisions": a shop with NO country is REFUSED, no silent India;
--    a country with no pack is SAID; a country change is a NEW entity · "Accounting and regulation are SEPARATE layers; a
--    country is a plug-in" — governance picks the pack per entity):
--   entity_governance.fy_start_month    smallint  1–12, the month the shop's financial year starts (India 4; the pack's default)
--   entity_governance.tax_registration  jsonb     { registered: bool, number: text|null, scheme: 'regular'|'composition'|null }
--                                                 — the number is ALSO identities.gstn (one home for the number the invoice prints;
--                                                   this object says registered/not and the scheme, which had no home but policy_flags)
--   entity_governance.setup_source      jsonb     { country: 'your time zone', currency: 'the usual currency in India', fy_start_month: 'the
--                                                 India pack', tax: 'typed' } — where each prefilled answer came from (M196 shows its source)
--   entity_governance.country_setup_at  timestamptz  WHEN the owner completed the step; NULL = still to do (the books stay shut)
--   The COUNTRY and CURRENCY stay where they live: identities.country · identities.currency_code (M196 writes them at verify, COALESCE;
--   the step CONFIRMS them). The pack itself is never stored — engines regulation.status(country) answers it from the registry.
--
-- BACKFILL (the brief: "existing Indian shops unaffected — backfill their profile from today's facts"): every entity whose country is
--   India (or still NULL — today's facts ARE India: 000_baseline defaulted the column to 'IN' and the ledger has only ever kept Indian
--   books) gets fy_start_month 4, its tax registration from identities.gstn + policy_flags.gst_registration, source 'backfill b299', and
--   the mark — so the gate never asks an existing shop to do a step it has, in effect, already done. A shop with NO stamp row (minted
--   before b254's trigger) gets the row the trigger would have written (its population's installation, else base @ platform-0).
--   A NON-Indian entity is NOT marked: its owner completes the step (and is told its books wait for the pack).
--
-- ⚠️ NOT in this file, for Athi to decide: `ALTER TABLE identities ALTER COLUMN country DROP DEFAULT` — the 'IN' default is the silent
--   India at the database; dropping it makes M196's COALESCE write real (today it never fills, the default is already there) but every
--   INSERT that names no country (minted parties, actors, customers) would then hold NULL. Readers tolerate NULL (profile, invoice party,
--   books-hooks dayOf all COALESCE); the blast radius is wider than this round, so it is stated here and not done.

BEGIN;

ALTER TABLE entity_governance ADD COLUMN IF NOT EXISTS fy_start_month   smallint;
ALTER TABLE entity_governance ADD COLUMN IF NOT EXISTS tax_registration jsonb;
ALTER TABLE entity_governance ADD COLUMN IF NOT EXISTS setup_source     jsonb;
ALTER TABLE entity_governance ADD COLUMN IF NOT EXISTS country_setup_at timestamptz;

ALTER TABLE entity_governance DROP CONSTRAINT IF EXISTS entity_governance_fy_start_month_chk;
ALTER TABLE entity_governance ADD CONSTRAINT entity_governance_fy_start_month_chk CHECK (fy_start_month IS NULL OR fy_start_month BETWEEN 1 AND 12);
ALTER TABLE entity_governance DROP CONSTRAINT IF EXISTS entity_governance_tax_registration_chk;
ALTER TABLE entity_governance ADD CONSTRAINT entity_governance_tax_registration_chk CHECK (tax_registration IS NULL OR jsonb_typeof(tax_registration) = 'object');
ALTER TABLE entity_governance DROP CONSTRAINT IF EXISTS entity_governance_setup_source_chk;
ALTER TABLE entity_governance ADD CONSTRAINT entity_governance_setup_source_chk CHECK (setup_source IS NULL OR jsonb_typeof(setup_source) = 'object');

COMMENT ON COLUMN entity_governance.fy_start_month   IS 'CS1: the month the financial year starts (1-12); India 4. Set by the owner in Country setup; backfilled 4 for Indian shops (b299).';
COMMENT ON COLUMN entity_governance.tax_registration IS 'CS1: { registered, number, scheme } — registered for the country''s indirect tax? the number (also identities.gstn), regular | composition.';
COMMENT ON COLUMN entity_governance.setup_source     IS 'CS1: where each prefilled answer came from — { country, currency, fy_start_month, tax } in words (M196: the time zone, the pack, typed).';
COMMENT ON COLUMN entity_governance.country_setup_at IS 'CS1: when the owner completed Country setup. NULL = still to do; the books routes answer 422 COUNTRY_SETUP_PENDING until then.';

-- ── BACKFILL ① a stamp row for every live entity that has none (the row identities_stamp_world() would have written) ──────────────
INSERT INTO entity_governance (entity_id, constitution_key, installation_key)
SELECT i.identity_id,
       COALESCE((SELECT ins.vertical_key FROM ops.population p JOIN installation ins ON ins.installation_key = p.installation_key
                  WHERE p.code = COALESCE(i.population, 'live') LIMIT 1), 'base'),
       COALESCE((SELECT p.installation_key FROM ops.population p WHERE p.code = COALESCE(i.population, 'live') LIMIT 1), 'platform-0')
  FROM identities i
  LEFT JOIN entity_governance g ON g.entity_id = i.identity_id
 WHERE i.identity_type = 'entity' AND g.entity_id IS NULL
ON CONFLICT (entity_id) DO NOTHING;

-- ── BACKFILL ② today's facts for every Indian (or country-less = Indian by the old default) entity not yet marked ────────────────────
UPDATE entity_governance g
   SET fy_start_month   = COALESCE(g.fy_start_month, 4),
       tax_registration = COALESCE(g.tax_registration, jsonb_build_object(
                            'registered', (NULLIF(TRIM(i.gstn), '') IS NOT NULL),
                            'number',     NULLIF(UPPER(TRIM(i.gstn)), ''),
                            'scheme',     CASE WHEN NULLIF(TRIM(i.gstn), '') IS NULL THEN NULL
                                               WHEN LOWER(COALESCE(i.policy_flags->>'gst_registration', 'regular')) = 'composition' THEN 'composition'
                                               ELSE 'regular' END)),
       setup_source     = COALESCE(g.setup_source, '{"country":"backfill b299 (today''s facts)","currency":"backfill b299","fy_start_month":"the India pack","tax":"backfill b299 (identities.gstn)"}'::jsonb),
       country_setup_at = COALESCE(g.country_setup_at, now())
  FROM identities i
 WHERE i.identity_id = g.entity_id
   AND i.identity_type = 'entity'
   AND COALESCE(UPPER(i.country), 'IN') = 'IN'
   AND g.country_setup_at IS NULL;

-- a country-less entity IS an Indian one today (the 000_baseline default) — say so in the row rather than leave the column NULL
UPDATE identities SET country = 'IN'
 WHERE identity_type = 'entity' AND country IS NULL
   AND identity_id IN (SELECT entity_id FROM entity_governance WHERE country_setup_at IS NOT NULL);

COMMIT;

-- ── PROOF ──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
-- columns there:        SELECT column_name FROM information_schema.columns WHERE table_name = 'entity_governance' AND column_name IN ('fy_start_month','tax_registration','setup_source','country_setup_at');
-- every Indian shop marked:  SELECT count(*) FILTER (WHERE g.country_setup_at IS NULL) AS still_to_do, count(*) AS indian
--                           FROM identities i JOIN entity_governance g ON g.entity_id = i.identity_id WHERE i.identity_type = 'entity' AND COALESCE(i.country,'IN') = 'IN';   -- still_to_do = 0
-- the non-Indian ones:  SELECT i.identity_id, i.country, g.country_setup_at FROM identities i JOIN entity_governance g ON g.entity_id = i.identity_id WHERE i.identity_type = 'entity' AND COALESCE(i.country,'IN') <> 'IN';
-- no entity without a stamp: SELECT * FROM ops.f_unstamped();   -- unstamped = 0 for every population
