-- b400_currency_no_default.sql — STD2 (GOV-AU1 for MONEY, standards review 14 Oct MUST-FIX 9): a money nobody stated is UNKNOWN (NULL),
--   never INR. The sibling of b376 (identities.country DROP DEFAULT 'IN').
--
-- ⚠️⚠️ DRAFT — NOT RUN · Athi runs it (Supabase SQL editor, AS postgres — ALTER TABLE needs the table owner, cb_app cannot).
--    Written offline, never executed here. Safe to re-run: DROP DEFAULT on a column with no default is a no-op; cb_entity is touched only
--    when it exists as a table with that column.
--    Until it runs nothing breaks: registration names the money (country-setup.offerOf / acceptAtSignup); the code no longer adds INR
--    on its own (books-store.saveSetting, books.enable, network-design, profile.invoiceParty, till /snapshot) — an unstated money is asked
--    for in ONE sentence (country-setup.MONEY_UNSTATED, code NO_MONEY).
--
-- RLS: unchanged — no policy, grant or table shape changes. Existing rows are NOT touched (no UPDATE): a shop stored 'INR' by the old
--    default stays 'INR'; its owner corrects it on Country setup while the shop is not constituted.
--
-- WHAT: identities.currency_code (db/schema.sql, 000_baseline) and cb_entity.currency_code (net03) lose DEFAULT 'INR'.
--    Written by: registration, Country setup, network-design (a store's own currency, else the network's, else NULL).
--    Read by: profile.invoiceParty → till /snapshot shop.currency; books.enable via Country setup. docs/FIELDS.md "STD2".
--
-- UNDO (only on Athi's word — it brings the India default back): ALTER TABLE identities ALTER COLUMN currency_code SET DEFAULT 'INR';

-- ═════ STEP 1 · PREVIEW (read-only) ═══════════════════════════════════════════════════════════════════════════
SELECT table_name, column_default FROM information_schema.columns
 WHERE table_schema = 'public' AND column_name = 'currency_code' AND table_name IN ('identities', 'cb_entity');

-- ═════ STEP 2 · APPLY ══════════════════════════════════════════════════════════════════════════════════════════
ALTER TABLE identities ALTER COLUMN currency_code DROP DEFAULT;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns c JOIN information_schema.tables t ON t.table_schema = c.table_schema AND t.table_name = c.table_name
              WHERE c.table_schema = 'public' AND c.table_name = 'cb_entity' AND c.column_name = 'currency_code' AND t.table_type = 'BASE TABLE') THEN
    ALTER TABLE cb_entity ALTER COLUMN currency_code DROP DEFAULT;
  END IF;
END $$;

-- ═════ PROOFS (read-only) ═══════════════════════════════════════════════════════════════════════════════════════
SELECT count(*) AS defaults_must_be_0 FROM information_schema.columns
 WHERE table_schema = 'public' AND column_name = 'currency_code' AND table_name IN ('identities', 'cb_entity') AND column_default IS NOT NULL;
