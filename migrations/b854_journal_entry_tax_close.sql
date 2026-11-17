-- b854_journal_entry_tax_close.sql — ACC-336 / 336b (12 Nov 2026): the tax close's own carried totals, stored on its set-off (or surplus) entry.
-- schema-lint: allow R5 tax_close is a JSON document of carried close figures (payable, utilised, paid, excess), not one amount column
--
-- ⚠️ NOT RUN anywhere · Athi runs it (Supabase SQL editor, AS postgres) after SIT has run it, AFTER b849. Safe to repeat (ADD COLUMN IF NOT EXISTS). Touches no row: a new nullable column.
--    Nothing reads or writes it until the ACC-336 build ships, and that code checks schema.hasColumn first, so the api is correct BEFORE and AFTER this file runs.
--
-- WHY. A close that has been posted must answer the same figures every time it is asked (replay), without re-deriving them from a ledger that has moved on. With the
--    ACC-336b add-back, "payable" is no longer readable from the span.end balances, so the figures the close used are CARRIED on its own entry and a replay compares two
--    carried totals (the stored figures against the live payments named for the period) — house rule "mismatch, not recompute". Option A of docs/critique/ACC-336-PLAN.md.
-- HOME. journal_entry.tax_close jsonb NULL beside b849's tax_period. journal_entry is insert-only for cb_app (GRANT SELECT, INSERT): the value is written in the SAME INSERT as the
--    close's tax_setoff entry (or, when nothing was utilised but cash was paid in excess, its surplus entry), so entry and figures cannot disagree. No side table, no second write.
-- VALUE (written by the api, never by SQL): { v: 1, base: {<head>: minor}, utilised: [{from, against, amount_minor}], payable: {<head>: minor}, paid: {<head>: minor},
--    excess: {<head>: minor}, paid_entries: [entry_id…], currency } — the heads of the pack, integer minor units, one currency (CUR-1). NULL for every other entry and all history:
--    a close made before this file ran is never backfilled (a guess in SQL would be a second rule).
-- NO INDEX. The close reads it by entry_id through the source_ref lookup it already does.
-- ROLL BACK (before the build ships it loses nothing; after, replay falls back to "closed before figures were carried"):
--    ALTER TABLE journal_entry DROP COLUMN IF EXISTS tax_close;
-- CHECK (read-only, one row):
--    SELECT count(*) AS has_column FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'journal_entry' AND column_name = 'tax_close';   Expect 1.
-- RLS: unchanged. journal_entry stays ENABLED + FORCED with its entity policy; no table is created here.

ALTER TABLE journal_entry
  ADD COLUMN IF NOT EXISTS tax_close jsonb
  CONSTRAINT journal_entry_tax_close_obj CHECK (tax_close IS NULL OR jsonb_typeof(tax_close) = 'object');

COMMENT ON COLUMN journal_entry.tax_close IS 'ACC-336: the figures a tax close used and answered (payable, utilised, paid, excess), carried on its own entry; NULL for every other entry and all history. Written in the same INSERT, never updated.';
