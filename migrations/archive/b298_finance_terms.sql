-- b298_finance_terms.sql — CB FINANCE round F2: credit TERMS stored as a shop default and a per-party override. NO new table.
--
-- ⚠️⚠️ DRAFT — NOT RUN · Athi runs it (Supabase SQL editor, AS postgres — ALTER TABLE needs the table owner, cb_app cannot).
--    Written offline, read, never executed. Safe to re-run (every statement is IF NOT EXISTS / guarded).
--    Until it runs, the Terms tab says "Terms arrive after the next update" (GET /api/books/terms → terms_migrated: false,
--    a write answers 503 TERMS_NOT_MIGRATED) — never a 500, and credit sales are checked against the party's own
--    credit_days / credit_limit_minor exactly as before.
--
-- RLS: WITHOUT any new policy — the three tables below already carry their own row-level-security policies
--    (books_setting b272 · customer_list b49 · supplier_list b270). A new column inherits them; a shop reads and writes only its own.
--
-- WHAT (DECISIONS 2026-10-09 "terms = shop default + per-party override, no new table"):
--   books_setting.terms   jsonb  the shop's DEFAULT terms: { credit_days, credit_limit_minor, interest: { on, rate_pct, grace_days },
--                                                              early: { pct, within_days } } — any key may be absent (= not set)
--   customer_list.terms   jsonb  this customer's OVERRIDE of interest / early only ({ interest, early }); a customer's days and limit
--   supplier_list.terms   jsonb  stay in the credit_days / credit_limit_minor columns b274 made — one home per fact, no copy
-- Change history is not a column: every change is a books_change_log row (table_name 'terms' / 'party_terms'), shown on the CRM record.

BEGIN;
ALTER TABLE books_setting ADD COLUMN IF NOT EXISTS terms jsonb;
ALTER TABLE customer_list ADD COLUMN IF NOT EXISTS terms jsonb;
ALTER TABLE supplier_list ADD COLUMN IF NOT EXISTS terms jsonb;
ALTER TABLE books_setting DROP CONSTRAINT IF EXISTS books_setting_terms_chk;
ALTER TABLE books_setting ADD CONSTRAINT books_setting_terms_chk CHECK (terms IS NULL OR jsonb_typeof(terms) = 'object');
ALTER TABLE customer_list DROP CONSTRAINT IF EXISTS customer_list_terms_chk;
ALTER TABLE customer_list ADD CONSTRAINT customer_list_terms_chk CHECK (terms IS NULL OR jsonb_typeof(terms) = 'object');
ALTER TABLE supplier_list DROP CONSTRAINT IF EXISTS supplier_list_terms_chk;
ALTER TABLE supplier_list ADD CONSTRAINT supplier_list_terms_chk CHECK (terms IS NULL OR jsonb_typeof(terms) = 'object');
COMMIT;

-- check after (expect 3 rows, all jsonb):
--   SELECT table_name, data_type FROM information_schema.columns WHERE column_name = 'terms'
--     AND table_name IN ('books_setting','customer_list','supplier_list');
