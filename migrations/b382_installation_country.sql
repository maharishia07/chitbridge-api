-- b382_installation_country.sql — GOV-SPIN (Athi, 14 Oct: "if we deploy a spin in australia region for australian businesses, then we
--   setup governance layer as Australia … and they have to accept to continue"): an installation STATES its country.
--
-- ⚠️⚠️ DRAFT — NOT RUN · Athi runs it (Supabase SQL editor, AS postgres — ALTER TABLE needs the table owner, cb_app cannot).
--    Written offline, never executed here. Safe to re-run (ADD COLUMN IF NOT EXISTS; the CHECK is added only when absent).
--    Until it runs nothing breaks: lib/govresolve.readInstallation selects `country` only once schema.hasColumn says it exists, and the
--    register panel then simply has no installation line (the browser's guess, as today).
--
-- RLS: unchanged — `installation` is shared reference WITHOUT RLS (b74 §5, SELECT-only for cb_app); no grant or policy changes.
--    Existing rows are NOT touched: 'platform-0' stays NULL = "no country stated, ask" (GOV-AU1: a country nobody stated is unknown).
--
-- WHAT: installation.country — ISO 3166-1 alpha-2, NULL allowed. Read by govresolve.cascade → `installation.country` and `basics.country`
--    (bounded by the constitution's optional `allowed.countries`, tighten-only) → GET /api/entities/constitutions `installation` → the
--    register panel ("This ChitBridge runs in Australia"). Written by: this column's owner only — a migration, deploy/spin-lib.sh
--    (CB_SPIN_COUNTRY, at spin time) or scripts/seed-local-installations.sql (local test rows au-test · ae-test · in-test, never production).
--
-- UNDO (only on Athi's word): ALTER TABLE installation DROP COLUMN country;

-- ═════ STEP 1 · PREVIEW (read-only) ═══════════════════════════════════════════════════════════════════════════
SELECT installation_key, region, currency, timezone FROM installation ORDER BY installation_key;

-- ═════ STEP 2 · APPLY ══════════════════════════════════════════════════════════════════════════════════════════
ALTER TABLE installation ADD COLUMN IF NOT EXISTS country varchar(2);
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'installation_country_iso2') THEN
    ALTER TABLE installation ADD CONSTRAINT installation_country_iso2 CHECK (country IS NULL OR country ~ '^[A-Z]{2}$');
  END IF;
END $$;
COMMENT ON COLUMN installation.country IS 'GOV-SPIN b382: the country this installation states (ISO-2). NULL = none stated: registration asks, never assumes.';

-- ═════ PROOFS (read-only) ═══════════════════════════════════════════════════════════════════════════════════════
SELECT count(*) AS country_column_must_be_1 FROM information_schema.columns
 WHERE table_schema = 'public' AND table_name = 'installation' AND column_name = 'country';
SELECT installation_key, country FROM installation WHERE installation_key = 'platform-0';   -- must be NULL
