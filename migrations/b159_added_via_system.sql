-- ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════
-- b159 — 'system' IS A PROVENANCE. Let the relationship lists say so.
-- ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════
--
-- ⚠️⚠️ FOUND BY b158 FAILING, 2026-09-14, and the failure was the good outcome.
--
-- b158 tried to write the root↔shop connection with `added_via = 'system'` and `supply_kind = 'service'`. Three
-- CHECK constraints refused it:
--
--     supplier_list_added_via_check    manual · transaction · import
--     supplier_list_supply_kind_chk    resale · own_use
--     customer_list_added_via_check    transaction · manual · import · catalogue
--
-- ⭐ THE CONSTRAINTS WERE RIGHT AND I WAS WRONG. I checked the UNIQUE indexes so `ON CONFLICT` would work and
-- never looked at the CHECKs — so `lib/rootlink.js` shipped writing a value the database would not accept. It
-- failed safely (meter-style: logged at warn, never breaks a registration) which is exactly why it went
-- unnoticed for an hour. A closed vocabulary caught a bug that a text column would have stored happily.
--
-- ── WHAT CHANGES, AND WHAT DELIBERATELY DOES NOT ───────────────────────────────────────────────────────────────
--
-- ✅ `added_via` GAINS 'system' on both tables. This is a genuinely new provenance and nothing existing means it:
--    'manual' is a person choosing, 'transaction' is a trade creating one, 'import' is a file, 'catalogue' is a
--    storefront order. None of them is "the platform did this at the mint".
--
--    ⚠️ AND THE DESIGN DEPENDS ON BEING ABLE TO RECOGNISE IT. Two things must treat the system link differently:
--       · the supplier screen must REFUSE to delete it, or a shop tidying its list kills its own support routing
--       · any supplier QUOTA count must EXCLUDE it — Starter allows ten and we would silently take one from
--         every shop for a supplier they never chose
--    Neither is built yet. The mark goes down first so the row can be recognised the day they are.
--
-- ❌ `supply_kind` does NOT change. 'service' was my invention; `own_use` already exists and is CORRECT — a shop
--    uses ChitBridge for its own operations, it does not resell it. Widening a constraint because I picked the
--    wrong word from outside it would be the actual mistake. b158 and lib/rootlink.js were changed instead.
--
-- Supabase → SQL Editor → paste → Run. Idempotent; safe to re-run. Run BEFORE re-running b158.
-- ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════

BEGIN;

ALTER TABLE supplier_list DROP CONSTRAINT IF EXISTS supplier_list_added_via_check;
ALTER TABLE supplier_list ADD  CONSTRAINT supplier_list_added_via_check
  CHECK (added_via::text = ANY (ARRAY['manual','transaction','import','system']::text[]));

ALTER TABLE customer_list DROP CONSTRAINT IF EXISTS customer_list_added_via_check;
ALTER TABLE customer_list ADD  CONSTRAINT customer_list_added_via_check
  CHECK (added_via::text = ANY (ARRAY['transaction','manual','import','catalogue','system']::text[]));

COMMIT;

-- ── WHAT YOU SHOULD SEE — both lists now accept 'system', and nothing else widened ─────────────────────────────
SELECT conrelid::regclass::text AS tbl, conname, pg_get_constraintdef(oid) AS def
  FROM pg_constraint
 WHERE conrelid IN ('customer_list'::regclass, 'supplier_list'::regclass)
   AND contype = 'c'
 ORDER BY 1, 2;
