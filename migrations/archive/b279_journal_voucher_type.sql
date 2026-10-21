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
-- ⚠️ NO BACKFILL (2026-10-03, Athi ran the first draft and it was refused: "The books are insert-only: UPDATE on journal_entry is
-- refused — correct with a reversing entry (Rule 3 audit trail)"). That refusal is RIGHT: journal_entry is insert-only (books_insert_only()),
-- and filling a column on old rows is an UPDATE. So existing entries keep voucher_type NULL, and the reader derives their type from the series
-- prefix (lib/books.js voucherTypeOfEntry: JV → Journal, SV → Sales …). Only entries written after this column exists carry it.
