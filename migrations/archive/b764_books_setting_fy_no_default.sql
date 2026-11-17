-- b764_books_setting_fy_no_default.sql - NEUTRAL-CORE N4 (17 Oct 2026): books_setting.fy_start_month loses its DEFAULT 4. NOT RUN - the owner runs it (Supabase editor).
-- CHECKED  looked at: b272 (the column: int NOT NULL DEFAULT 4 + books_setting_fy_chk BETWEEN 1 AND 12), the one writer lib/books-store.js saveSetting (it names
--          fy_start_month in its INSERT and REFUSES a missing one with NO_MONEY before it gets there), books.enable (the pack's fiscalYear.startMonth), b299
--          (entity_governance.fy_start_month, backfilled 4 for Indian shops). b763 already dropped the other national defaults on this table (country, functional_currency).
-- WHY      a row that does not state its year must fail loudly instead of answering April - India's year - for a shop in any country (Athi 2026-10-17: "a record states its
--          own country/currency/zone/language; a reader that finds none says so - never guesses India").
-- OWNER    cb-platform (migrations/). No new table, no new column, no data touched: every existing row keeps the month it holds.
-- EDITOR-SAFE  one ALTER, no BEGIN/COMMIT of its own; idempotent (DROP DEFAULT is a no-op the second time); skipped when the table or column is absent.
-- ROLLBACK  ALTER TABLE books_setting ALTER COLUMN fy_start_month SET DEFAULT 4;   (not advised)

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'books_setting' AND column_name = 'fy_start_month') THEN
    ALTER TABLE public.books_setting ALTER COLUMN fy_start_month DROP DEFAULT;
  END IF;
END $$;
