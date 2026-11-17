-- b849_journal_entry_tax_period.sql — ACC-336 slice 1a (9 Nov 2026): the payment's tax period, carried on the entry.
-- schema-lint: allow R5 tax_period is a period key such as gstr3b:2026-04, not an amount
--
-- ⚠️ NOT RUN anywhere · Athi runs it (Supabase SQL editor, AS postgres) after SIT has run it. Safe to repeat (ADD COLUMN IF NOT EXISTS). Touches no row: a new nullable column.
--    Nothing reads or writes it until ACC-336 slice 2 (api) ships, and that code checks schema.hasColumn first, so the api is correct BEFORE and AFTER this file runs.
--
-- WHY. The GST close must count a payment toward a period by the period the payment NAMES, never by its date (design ACC-336 rev 4 section 4, critic C2/R4). gstPay builds the
--    period span and throws it away; the entry keeps only source_ref 'gstpay:<challan>' and a date. journal_entry.period is the ledger month of the posting date, not the tax period.
-- HOME (cb-db decision): journal_entry.tax_period text NULL, beside `period`. Why a column and not a side row keyed by entry_id:
--    (1) journal_entry is insert-only for cb_app (GRANT SELECT, INSERT, no UPDATE): the value is written in the same INSERT as the payment, so entry and period can never
--        disagree and there is no second write that could be missed; a side table would need its own table, RLS policy, grants and a second INSERT in the same transaction.
--    (2) the close reads it in the query it already runs (books-store.js:215 shape: unreversed entries on a head's roles); a side row adds a join to every paid-for read.
--    (3) RLS needs nothing new: journal_entry is already ENABLED + FORCED with its entity policy, and the table-level INSERT grant already covers a new column.
--    Cost: one nullable text on a large table. A nullable column with no default is a catalog-only change in PostgreSQL (no rewrite, no long lock).
-- VALUE. The tax period's own key, as books-period closeSpan builds it ('<returns id>:<period>' or the FY form '<fy>:<month>'); never inside source_ref.
--    All history stays NULL: the design counts a NULL-period payment only by its single candidate period (api side), never by a backfill here (a guess in SQL would be a second rule).
-- NO INDEX YET. The paid-for read filters by entity and role lines first; no index is added until a measured plan says so (no WHY, no index).
-- DICTIONARY. docs/FIELDS.md is the dictionary of response keys; the key `tax_period` (POST /gst/pay output, optional) is slice 3 (cb-api) with the register row.
--    This is a ledger column, not a product column, so tests/field-ledger.test.cjs does not apply.
-- ROLL BACK (before slice 2 ships it loses nothing; after, it loses the carried periods):
--    ALTER TABLE journal_entry DROP COLUMN IF EXISTS tax_period;
-- CHECK (read-only, one row):
--    SELECT count(*) AS has_column FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'journal_entry' AND column_name = 'tax_period';   Expect 1.
-- RLS: unchanged. journal_entry stays ENABLED + FORCED with its entity policy; no table is created here.

ALTER TABLE journal_entry
  ADD COLUMN IF NOT EXISTS tax_period text
  CONSTRAINT journal_entry_tax_period_len CHECK (tax_period IS NULL OR char_length(tax_period) BETWEEN 1 AND 64);

COMMENT ON COLUMN journal_entry.tax_period IS 'ACC-336: the tax period a payment entry names (books-period closeSpan key); NULL for every other entry and all history. Written in the same INSERT, never updated.';
