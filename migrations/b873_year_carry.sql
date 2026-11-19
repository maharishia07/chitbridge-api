-- b873_year_carry.sql — l16-scale (16 Nov 2026, 5-year growth): a year's carried-forward opening, kept once, so no read re-walks every year before it.
--
-- ⚠️ NOT RUN anywhere · Athi's deployer lane runs it (Supabase SQL editor, AS postgres), SIT first. Safe to repeat (IF NOT EXISTS, DROP POLICY IF EXISTS). A new table only; no row of any old table is touched.
-- The api is correct BEFORE and AFTER this file runs: before it, the carry is computed from every year on each read as it always was (lib/books.js yearBalances); after it, a year's carry is read from here when its key still matches.
-- WHAT IT IS. A CACHE OF A COMPUTED ANSWER, never a book: the rows CBLedger.carryForward made for a year (its period-0 opening), exactly as yearBalances derives them. It is NOT a journal and NOT counted in any balance (account_balance and the
--    journal are untouched), so the nightly drift check has nothing new to compare.
--    carry_year_key  the key the carry was made under = a hash of (the previous year's stored month rows: count, Σ Dr, Σ Cr, Σ lines) + (the key of the year before it) + (the pack: country, currency, FY month, engine pins).
--                    A late correction in ANY earlier year changes that year's month rows, so every later key changes, the old row is simply not asked for again, and the carry is made again and stored under the new key. Nothing is ever updated.
--    rows            the carry: [{ code, party, dr_minor, cr_minor }] (fiscal_year = this year, period = 0), the same rows yearBalances appends.
--    retained_minor · profit_minor   the two figures CBLedger.carryForward answered beside its rows (the opening-years strip shows them; stored so it never makes a year's carry again to read them).
-- LOOKED AT (DISCIPLINES 4a): no second carry calculation — the engine's own rows are what is stored; the table is read only when the key matches the one the same inputs give now.
-- OWNER: lib/books.js (yearBalances) + lib/books-store.js (carryRead / carryWrite). RETENTION: a derived cache; a row is superseded by a changed key (a few per shop in its life); the books themselves keep their 8-year floor.
-- ROLL BACK (nothing else depends on it): DROP TABLE IF EXISTS year_carry;
-- CHECK (read-only, all-true block; every row must read ok = true):
--    SELECT 'table exists' AS what, count(*) = 1 AS ok FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'year_carry'
--    UNION ALL SELECT 'RLS enabled and forced', count(*) = 1 FROM pg_class WHERE oid = 'public.year_carry'::regclass AND relrowsecurity AND relforcerowsecurity
--    UNION ALL SELECT 'entity policy', count(*) = 1 FROM pg_policies WHERE tablename = 'year_carry' AND policyname = 'rls_entity'
--    UNION ALL SELECT 'cb_app has no UPDATE or DELETE', count(*) = 0 FROM information_schema.role_table_grants WHERE table_name = 'year_carry' AND grantee = 'cb_app' AND privilege_type IN ('UPDATE', 'DELETE')
--    UNION ALL SELECT 'one carry per key', count(*) = 1 FROM pg_indexes WHERE tablename = 'year_carry' AND indexname = 'year_carry_once';
-- RLS: ENABLE + FORCE + the one entity policy (as bank_statement_file b872). cb_app may SELECT and INSERT only; books_insert_only() refuses UPDATE and DELETE for every role. cb_backup may SELECT.

BEGIN;
SET LOCAL lock_timeout = '5s';

CREATE TABLE IF NOT EXISTS year_carry (
  id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_id      uuid        NOT NULL,
  fiscal_year    text        NOT NULL CHECK (char_length(fiscal_year) BETWEEN 4 AND 12),
  carry_year_key text        NOT NULL CHECK (carry_year_key ~ '^[0-9a-f]{64}$'),
  rows           jsonb       NOT NULL CHECK (jsonb_typeof(rows) = 'array'),
  row_count      integer     NOT NULL CHECK (row_count >= 0),
  retained_minor bigint      NOT NULL DEFAULT 0,
  profit_minor   bigint      NOT NULL DEFAULT 0,
  created_at     timestamptz NOT NULL DEFAULT now());
-- WHY: one carry per shop, year and key (a second writer racing the first is refused quietly: ON CONFLICT DO NOTHING); the read is exactly this key
CREATE UNIQUE INDEX IF NOT EXISTS year_carry_once ON year_carry (entity_id, fiscal_year, carry_year_key);

ALTER TABLE year_carry ENABLE ROW LEVEL SECURITY;  ALTER TABLE year_carry FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS rls_entity ON year_carry;
CREATE POLICY rls_entity ON year_carry
  USING (entity_id = NULLIF(current_setting('app.current_entity', true), '')::uuid)
  WITH CHECK (entity_id = NULLIF(current_setting('app.current_entity', true), '')::uuid);

DROP TRIGGER IF EXISTS year_carry_insert_only ON year_carry;
CREATE TRIGGER year_carry_insert_only BEFORE UPDATE OR DELETE ON year_carry FOR EACH ROW EXECUTE FUNCTION public.books_insert_only();

REVOKE ALL ON year_carry FROM cb_app, cb_backup;
REVOKE UPDATE, DELETE, TRUNCATE ON year_carry FROM cb_app;  -- stated again beside the GRANT: migration-lint reads an insert-only GRANT with this exact REVOKE
GRANT SELECT, INSERT ON year_carry TO cb_app;
GRANT SELECT ON year_carry TO cb_backup;
COMMENT ON TABLE year_carry IS 'l16-scale: a cache of CBLedger.carryForward''s rows for one year (its period-0 opening), under a key that changes when any earlier year''s month rows change; never a book, never counted in a balance; insert-only.';

COMMIT;
