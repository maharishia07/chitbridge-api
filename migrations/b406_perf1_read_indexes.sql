-- b406_perf1_read_indexes.sql — PERF1 (2026-10-14): THE BOOKS' READS HOLD UP AT 100k LINES PER SHOP. Indexes only — no column, no row, no grant.
--   Athi, 14 Oct: "assuming a ledger has 1000 entries … are you loading all at once? … check all the data retrieval logic". Each index below names
--   the read it serves (lib/books-store.js unless said); the before/after timings are in docs/SIM-LOAD.md "Scale".
--
-- ⚠️⚠️ DRAFT — NOT RUN · Athi runs it (Supabase SQL editor, AS postgres). Safe to re-run (IF NOT EXISTS). Plain CREATE INDEX (the editor runs a script in
--    one transaction, where CONCURRENTLY is refused); each takes a short write lock on its table — run it outside shop hours.
--    Until it runs: every read answers exactly as before, only slower at scale. Nothing in the code checks for these names.
--
-- RLS: unchanged — no table is created; the books tables keep b273's policies, INSERT-only grants and no-UPDATE/no-DELETE triggers.

-- 1 · "Reversed by …" — the reversal of the entries on a page, ONE lookup per page (entryLines · ledgerLines · paymentsNeedingAdvice)
CREATE INDEX IF NOT EXISTS journal_entry_reverses_idx ON journal_entry (entity_id, reverses_entry_id) WHERE reverses_entry_id IS NOT NULL;
-- 2 · the Day book / Ledger keyset page: (posting_date, entry_no) is the order every page is read in, and the "after" cursor
CREATE INDEX IF NOT EXISTS journal_entry_page_idx ON journal_entry (entity_id, posting_date, entry_no);
-- 3 · a ledger's lines by account, joined to their entry (the ledger page and the SUM before the page) — b273's (entity_id, account_id) + the entry
CREATE INDEX IF NOT EXISTS journal_line_account_entry_idx ON journal_line (entity_id, account_id, entry_id);
-- 4 · one year's month rows (yearRows · years · periodSums): account_balance's key leads (entity_id, account_id …), so a year filter read every row of the shop
CREATE INDEX IF NOT EXISTS account_balance_year_idx ON account_balance (entity_id, fiscal_year, period);
-- 5 · a control account's open items, by party (items(…, parties[]) — the CRM page, the cheques list, /dues)
CREATE INDEX IF NOT EXISTS party_item_account_party_idx ON party_item (entity_id, account_id, party_id);
-- 6 · a cheque's latest status row (cheques · paymentsNeedingAdvice): was a scan of the shop's items per cheque
CREATE INDEX IF NOT EXISTS party_item_payment_idx ON party_item (entity_id, payment_id) WHERE payment_id IS NOT NULL;
-- 7 · the till's ?since= poll (routes/till.js snapshot delta): catalogue rows changed after the cursor, oldest first
CREATE INDEX IF NOT EXISTS catalogue_items_updated_idx ON catalogue_items (entity_id, updated_at);

ANALYZE journal_entry; ANALYZE journal_line; ANALYZE account_balance; ANALYZE party_item; ANALYZE catalogue_items;
