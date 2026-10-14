-- b376_identities_country_no_default.sql — GOV-AU1 (Athi, 14 Oct: "yes drop the DEFAULT 'IN' too"): a country nobody stated is UNKNOWN
--   (NULL), never India.
--
-- ⚠️⚠️ DRAFT — NOT RUN · Athi runs it (Supabase SQL editor, AS postgres — ALTER TABLE needs the table owner, cb_app cannot).
--    Written offline, never executed here. Safe to re-run: DROP DEFAULT on a column with no default is a no-op.
--    Until it runs nothing breaks: every INSERT INTO identities in routes/ and lib/ now NAMES its country (tests/identity-country.test.cjs),
--    so the default is never reached by the app — this removes it for anything else (a script, a hand INSERT, a future writer).
--
-- RLS: unchanged — no policy, grant or table shape changes. Existing rows are NOT touched (no UPDATE): a shop stored 'IN' by the old
--    default stays 'IN'; its owner corrects it on Country setup while the shop is not constituted (lib/country-setup.js).
--
-- WHY: F7 on the local walk (NIGHT-2026-10-13) — a shop registered from Sydney was stored as India because the INSERT named no country
--    and 000_baseline's `country VARCHAR(2) DEFAULT 'IN'` filled it. FX-AU1 (api #160) made registration name it; this removes the
--    silent fallback for good. A shop with NULL country is asked by Country setup (CS.gate NO_COUNTRY); a party with NULL country takes
--    the shop's only where the trade says so (lib/tax-lines.walkIn).
--
-- UNDO (only on Athi's word — it brings the bug back): ALTER TABLE identities ALTER COLUMN country SET DEFAULT 'IN';

-- ═════ STEP 1 · PREVIEW (read-only) ═══════════════════════════════════════════════════════════════════════════
SELECT column_default AS identities_country_default_today
  FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'identities' AND column_name = 'country';

-- ═════ STEP 2 · APPLY ══════════════════════════════════════════════════════════════════════════════════════════
ALTER TABLE identities ALTER COLUMN country DROP DEFAULT;

-- ═════ PROOFS (read-only) ═══════════════════════════════════════════════════════════════════════════════════════
SELECT (SELECT count(*) FROM information_schema.columns
         WHERE table_schema = 'public' AND table_name = 'identities' AND column_name = 'country' AND column_default IS NOT NULL) AS default_must_be_0;
