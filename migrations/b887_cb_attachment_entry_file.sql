-- b887_cb_attachment_entry_file.sql — a receipt on a POSTED ENTRY of the books (S1 of REQ-2026-11-20-evidence-and-classification-checks, critic change 1; 20 Nov 2026).
--
-- ⚠️ NOT RUN anywhere · Athi runs it (Supabase SQL editor, AS postgres), SIT first. Safe to repeat. Run it BEFORE the code deploys, or the "Attach receipt" door answers in words that the shop's evidence is not switched on yet (no 500; the Day book is unchanged).
-- Adds two NULLABLE columns to cb_attachment: entry_id (the journal entry the file sits on; no chit is invented: a chit is a document between parties) and sha256 (the file's hash, for the exact-copy note).
-- Every existing row keeps entry_id NULL, sha256 NULL: nothing is read or changed. RLS is unchanged: the row is the shop's own (entity_id), the policy rls_entity and FORCE RLS already cover the new columns.
-- No foreign key on purpose: journal_entry is insert-only and the file is the shop's own copy; the route checks the entry belongs to THIS shop before it writes (a key would also make the shop's purge routine fail on a test shop).
-- Add-only is held by the door (no delete or replace route answers for a file with an entry_id) and by the retention rule: purge_test_entities is the only job that deletes these rows, and it deletes a whole test shop.
-- ROLL BACK (first SELECT count(*) FROM cb_attachment WHERE entry_id IS NOT NULL; above 0 means receipts on entries would be lost: STOP and ask; at 0):
--   BEGIN; DROP INDEX IF EXISTS cb_attachment_entity_sha_idx; DROP INDEX IF EXISTS cb_attachment_entity_entry_idx; ALTER TABLE cb_attachment DROP CONSTRAINT IF EXISTS cb_attachment_entry_one_home; ALTER TABLE cb_attachment DROP COLUMN IF EXISTS sha256; ALTER TABLE cb_attachment DROP COLUMN IF EXISTS entry_id; COMMIT;
-- CHECK (read-only): SELECT count(*) = 2 AS ok FROM information_schema.columns WHERE table_name = 'cb_attachment' AND column_name IN ('entry_id', 'sha256');   (true after)
BEGIN;
SET LOCAL lock_timeout = '5s';   -- a busy table fails the run fast (nothing changes; run it again) instead of queueing the live site behind it
ALTER TABLE cb_attachment ADD COLUMN IF NOT EXISTS entry_id uuid;
ALTER TABLE cb_attachment ADD COLUMN IF NOT EXISTS sha256 text;
-- a file is on a chit, on a message, or on an entry: never two of them
ALTER TABLE cb_attachment DROP CONSTRAINT IF EXISTS cb_attachment_entry_one_home;
ALTER TABLE cb_attachment ADD CONSTRAINT cb_attachment_entry_one_home CHECK (entry_id IS NULL OR (chit_id IS NULL AND message_id IS NULL)) NOT VALID;
CREATE INDEX IF NOT EXISTS cb_attachment_entity_entry_idx ON cb_attachment (entity_id, entry_id) WHERE entry_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS cb_attachment_entity_sha_idx ON cb_attachment (entity_id, sha256) WHERE sha256 IS NOT NULL;
COMMIT;
