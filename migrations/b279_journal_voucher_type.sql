-- b279_journal_voucher_type.sql — DRAFT — NOT RUN · Athi runs it.
--
-- WHY: engines v1.16.0 numbers vouchers by TYPE (SV · PV · RV · PY · CV · CN · DN · JV) and gives a person's own entry the single series MJ, which must
-- keep its voucher type (Payment · Receipt · Contra · Journal …) beside it (DECISIONS "Voucher numbering follows the standard"). journal_entry.series
-- already exists and is written; the TYPE has no column. Until this runs the type is DERIVED (lib/books.js voucherTypeOfEntry: series prefix, else
-- the event) — so a manual entry's chosen kind is not yet kept, only its series (MJ).
--
-- AFTER IT RUNS: lib/books-store.js insertEntry adds voucher_type to its INSERT (h.voucher_type is already passed by writeLines). Not before: an INSERT naming
-- a missing column would fail every posting.
--
-- Existing entries keep their numbers (JV/…); their series is 'JV' already, so nothing is renumbered. Safe to re-run.

ALTER TABLE journal_entry ADD COLUMN IF NOT EXISTS voucher_type text;
-- backfill from the series prefix (a manual MJ entry written before this column stays NULL — derived as Journal)
UPDATE journal_entry SET voucher_type = CASE series
  WHEN 'SV' THEN 'Sales' WHEN 'PV' THEN 'Purchase' WHEN 'RV' THEN 'Receipt' WHEN 'PY' THEN 'Payment'
  WHEN 'CV' THEN 'Contra' WHEN 'CN' THEN 'Credit note' WHEN 'DN' THEN 'Debit note' WHEN 'JV' THEN 'Journal' END
 WHERE voucher_type IS NULL AND series <> 'MJ';
