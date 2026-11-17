-- b392_journal_line_fx.sql — FX1 (2026-10-14): A JOURNAL LINE NAMES ITS TRANSACTION CURRENCY AND THE RATE IT USED.
--   b273 gave journal_line `amount_txn_minor` and `fx_rate` but not the currency they are in, so a party's USD balance could not be told from its INR one.
--   Three nullable columns, written by lib/books.js postEntry (the one writer) once they exist; a line written before b392 reads as its own `currency`.
--
-- ⚠️⚠️ DRAFT — NOT RUN · Athi runs it (Supabase SQL editor, AS postgres), after b391. Safe to re-run (ADD COLUMN IF NOT EXISTS).
--    Until it runs: lines are written exactly as before (schema.hasColumn, cached); a foreign SETTLEMENT and the revaluation answer 503 BOOKS_NOT_MIGRATED in
--    words (they need the foreign balance these columns hold). Never a 500.
--
-- RLS: unchanged — journal_line keeps b273's policy, its INSERT-only grants and its no-UPDATE / no-DELETE trigger (Companies (Accounts) Rules 3(1)).
--
-- WHAT (chitbridge-api docs/FIELDS.md "journal_line · FX1"):
--   txn_currency    text  the currency amount_txn_minor is in (USD on a line of a USD bill; the functional currency on every other line)
--   fx_rate_source  text  the rate's source as the fx_rate row said it (manual · import · official), or 'event' when the caller handed the rate in
--   fx_rate_date    date  the day of the rate used (the bill's day; the closing day on a revaluation)
ALTER TABLE journal_line ADD COLUMN IF NOT EXISTS txn_currency   text;
ALTER TABLE journal_line ADD COLUMN IF NOT EXISTS fx_rate_source text;
ALTER TABLE journal_line ADD COLUMN IF NOT EXISTS fx_rate_date   date;
CREATE INDEX IF NOT EXISTS journal_line_txn_ccy_idx ON journal_line (entity_id, txn_currency, account_id, party_id) WHERE txn_currency IS NOT NULL;
COMMENT ON COLUMN journal_line.txn_currency IS 'FX1: the currency amount_txn_minor is in; null on lines written before b392 (= currency)';
