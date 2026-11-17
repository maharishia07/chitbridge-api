-- b302_ledger_account_source_code.sql — IM1 (2026-10-12): MOVE IN FROM XERO / QUICKBOOKS — the account code a ledger had in the system the
--   shop moved in from, kept ON the ledger so a trial balance and an open-bills file exported later still find it. NO new table.
--
-- ⚠️⚠️ DRAFT — NOT RUN · Athi runs it (Supabase SQL editor, AS postgres — ALTER TABLE needs the table owner, cb_app cannot).
--    Written offline, read, never executed. Safe to re-run (every statement is IF NOT EXISTS).
--    Until it runs: the move-in importer still adds the ledgers (the code is matched by NAME on a later file) and its outcome says
--    `source_code_written: false` in words; POST /api/books/accounts ignores a `source_code` it cannot keep and says so. Never a 500.
--
-- RLS: WITHOUT any new policy — ledger_account carries its entity policy from b272 (entity_id = app.current_entity); the new column inherits it.
--
-- WHAT (IM0 research record, chitbridge-web docs/research/XERO-QBO-EXPORTS-2026-10.md §3 "their account code has no home";
--    FIELDS.md "ledger_account.source_code"):
--   ledger_account.source_code   text   their code as exported (Xero `*Code`, QBO `Account` / AcctNum), ≤ 20 characters (QBO AU allows 20), trimmed.
--                                       NULL = a ledger that was not moved in (every ledger seeded from the pack, and one the shop typed).
--                                       OUR code (ledger_account.code) stays the system's 4 digits — theirs never becomes ours (REQUIREMENT "who chooses the numbers").
--   One source code per shop: a second ledger claiming a code already held is a COLLISION and is refused in words (lib/books addAccount, the importer's dry run).
ALTER TABLE ledger_account ADD COLUMN IF NOT EXISTS source_code text;
CREATE UNIQUE INDEX IF NOT EXISTS ledger_account_source_code_uq ON ledger_account (entity_id, source_code) WHERE source_code IS NOT NULL;
COMMENT ON COLUMN ledger_account.source_code IS 'IM1: the account code this ledger had in Xero / QuickBooks (kept, never used as ours); one per shop';
