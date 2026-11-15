-- b872_bank_statement_file.sql — l16 Statements box (15 Nov 2026, W15-51): a bank statement is filed AGAINST a bank account of the shop and a statement period, never a loose inbox (Athi, 15 Nov).
--
-- ⚠️ NOT RUN anywhere · Athi's deployer lane runs it (Supabase SQL editor, AS postgres), SIT first. Safe to repeat (IF NOT EXISTS, DROP POLICY IF EXISTS). New tables only; no row of any old table is touched.
-- The api is correct BEFORE and AFTER this file runs: before it, every door of the box answers 503 BOOKS_NOT_MIGRATED in words (the Bank page keeps its device-only picker); nothing else reads these tables.
-- LOOKED AT (DISCIPLINES 4a): the bytes go through the ONE storage adapter (lib/storage.js, a cb_attachment row with no chit and no message: attachment_id here); NO second byte store. cb_attachment is not widened (each new column
--    there would be nullable by design and would change the baseline fingerprint). Swept for a purge of cb_attachment rows with a null chit and message: none in lib/ routes/ scripts/ (the three deletes are one row by id, one chit's
--    own rows, and the test-entity cleanup by entity), so the bytes outlive the 5-year AU record period; the box has NO delete (a row is insert-only).
-- WHAT IT DOES.
--    bank_statement_file        one row per file kept: entity_id, account_id (a CHART ledger account of the shop, as GET /accounts returns it), label (the owner's own "..1234", typed once), period_from/period_to (NOT NULL, read from the file),
--                               currency (the account's), sha256 (NOT NULL: sha256 of the UTF-8 text the reader sees, the ONE hash, bkbHash), attachment_id (the adapter's opaque id of the bytes), name, size, mime,
--                               kind ('bank_statement' now; a bill later), source ('owner' | 'adviser' | 'feed'), overlap_flag (the period crossed another file of the same account at the write), by_user, by_name, by_firm, grant_id, created_at.
--                               UNIQUE (entity_id, account_id, sha256): the same file on the same account is stored once.
--    bank_statement_file_event  insert-only: added · read · downloaded, who (by_user, by_name, by_firm, grant_id) and when, stamped by the server.
-- OWNER: lib/bank-statement-file.js (the writers and the list), routes/books.js (the doors).
-- ROLL BACK (nothing else depends on them; the bytes stay in cb_attachment and are not deleted here):
--    DROP TABLE IF EXISTS bank_statement_file_event; DROP TABLE IF EXISTS bank_statement_file;
-- CHECK (read-only, all-true block; every row must read ok = true):
--    SELECT 'tables exist' AS what, count(*) = 2 AS ok FROM information_schema.tables WHERE table_schema = 'public' AND table_name IN ('bank_statement_file', 'bank_statement_file_event')
--    UNION ALL SELECT 'RLS enabled and forced', count(*) = 2 FROM pg_class WHERE oid IN ('public.bank_statement_file'::regclass, 'public.bank_statement_file_event'::regclass) AND relrowsecurity AND relforcerowsecurity
--    UNION ALL SELECT 'entity policy on both', count(*) = 2 FROM pg_policies WHERE tablename IN ('bank_statement_file', 'bank_statement_file_event') AND policyname = 'rls_entity'
--    UNION ALL SELECT 'cb_app has no UPDATE or DELETE', count(*) = 0 FROM information_schema.role_table_grants WHERE table_name IN ('bank_statement_file', 'bank_statement_file_event') AND grantee = 'cb_app' AND privilege_type IN ('UPDATE', 'DELETE')
--    UNION ALL SELECT 'one file once per account', count(*) = 1 FROM pg_indexes WHERE tablename = 'bank_statement_file' AND indexname = 'bank_statement_file_once';
-- RLS: ENABLE + FORCE + the one entity policy on each (as bank_rec_log b864). cb_app may SELECT and INSERT only; books_insert_only() refuses UPDATE and DELETE for every role. cb_backup may SELECT.

BEGIN;
SET LOCAL lock_timeout = '5s';

CREATE TABLE IF NOT EXISTS bank_statement_file (
  id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  seq            bigint      GENERATED ALWAYS AS IDENTITY,
  entity_id      uuid        NOT NULL,
  account_id     uuid        NOT NULL,
  label          text        CHECK (label IS NULL OR char_length(label) <= 40),
  period_from    date        NOT NULL,
  period_to      date        NOT NULL,
  currency       text        NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
  sha256         text        NOT NULL CHECK (sha256 ~ '^[0-9a-f]{64}$'),
  attachment_id  uuid        NOT NULL,
  name           text        NOT NULL CHECK (char_length(name) BETWEEN 1 AND 200),
  size           integer     NOT NULL CHECK (size BETWEEN 1 AND 6291456),
  mime           text        NOT NULL,
  kind           text        NOT NULL DEFAULT 'bank_statement' CHECK (kind IN ('bank_statement')),
  source         text        NOT NULL CHECK (source IN ('owner', 'adviser', 'feed')),
  overlap_flag   boolean     NOT NULL DEFAULT false, -- "overlaps" is a reserved word; the api reads it back as overlaps
  by_user        uuid,
  by_name        text        CHECK (by_name IS NULL OR char_length(by_name) <= 200),
  by_firm        text        CHECK (by_firm IS NULL OR char_length(by_firm) <= 200),
  grant_id       uuid,
  created_at     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT bank_statement_file_period_chk CHECK (period_to >= period_from));
-- the same file on the same account is stored once (a duplicate is refused in words, never stored twice)
CREATE UNIQUE INDEX IF NOT EXISTS bank_statement_file_once ON bank_statement_file (entity_id, account_id, sha256);
-- WHY: the list is one shop, account by account, in period order (entity_id leads for RLS); a firm view later is one paged call per shop
CREATE INDEX IF NOT EXISTS bank_statement_file_account_idx ON bank_statement_file (entity_id, account_id, period_from);

CREATE TABLE IF NOT EXISTS bank_statement_file_event (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  seq         bigint      GENERATED ALWAYS AS IDENTITY,
  entity_id   uuid        NOT NULL,
  file_id     uuid        NOT NULL,
  event       text        NOT NULL CHECK (event IN ('added', 'read', 'downloaded')),
  by_user     uuid,
  by_name     text        CHECK (by_name IS NULL OR char_length(by_name) <= 200),
  by_firm     text        CHECK (by_firm IS NULL OR char_length(by_firm) <= 200),
  grant_id    uuid,
  at          timestamptz NOT NULL DEFAULT now());
CREATE INDEX IF NOT EXISTS bank_statement_file_event_file_idx ON bank_statement_file_event (entity_id, file_id, seq);

ALTER TABLE bank_statement_file ENABLE ROW LEVEL SECURITY;  ALTER TABLE bank_statement_file FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS rls_entity ON bank_statement_file;
CREATE POLICY rls_entity ON bank_statement_file
  USING (entity_id = NULLIF(current_setting('app.current_entity', true), '')::uuid)
  WITH CHECK (entity_id = NULLIF(current_setting('app.current_entity', true), '')::uuid);
ALTER TABLE bank_statement_file_event ENABLE ROW LEVEL SECURITY;  ALTER TABLE bank_statement_file_event FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS rls_entity ON bank_statement_file_event;
CREATE POLICY rls_entity ON bank_statement_file_event
  USING (entity_id = NULLIF(current_setting('app.current_entity', true), '')::uuid)
  WITH CHECK (entity_id = NULLIF(current_setting('app.current_entity', true), '')::uuid);

-- insert-only, the books' own pattern: the trigger refuses UPDATE and DELETE for every role (and the grant below never gave them to cb_app)
DROP TRIGGER IF EXISTS bank_statement_file_insert_only ON bank_statement_file;
CREATE TRIGGER bank_statement_file_insert_only BEFORE UPDATE OR DELETE ON bank_statement_file FOR EACH ROW EXECUTE FUNCTION public.books_insert_only();
DROP TRIGGER IF EXISTS bank_statement_file_event_insert_only ON bank_statement_file_event;
CREATE TRIGGER bank_statement_file_event_insert_only BEFORE UPDATE OR DELETE ON bank_statement_file_event FOR EACH ROW EXECUTE FUNCTION public.books_insert_only();

REVOKE ALL ON bank_statement_file FROM cb_app, cb_backup;
REVOKE UPDATE, DELETE, TRUNCATE ON bank_statement_file FROM cb_app;  -- stated again beside the GRANT: migration-lint reads an insert-only GRANT with this exact REVOKE
GRANT SELECT, INSERT ON bank_statement_file TO cb_app;
GRANT SELECT ON bank_statement_file TO cb_backup;
REVOKE ALL ON bank_statement_file_event FROM cb_app, cb_backup;
REVOKE UPDATE, DELETE, TRUNCATE ON bank_statement_file_event FROM cb_app;
GRANT SELECT, INSERT ON bank_statement_file_event TO cb_app;
GRANT SELECT ON bank_statement_file_event TO cb_backup;
COMMENT ON TABLE bank_statement_file IS 'l16 Statements box: one bank statement file kept against a bank account (chart ledger account) and a statement period; bytes in the storage adapter (attachment_id); sha256 = the UTF-8 text hash the Bank reader uses; insert-only.';
COMMENT ON TABLE bank_statement_file_event IS 'l16 Statements box: who added, read or downloaded a kept statement and when; insert-only, stamped by the server.';

COMMIT;
