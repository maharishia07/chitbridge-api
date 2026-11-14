-- b864_bank_rec_log.sql — FIN-70 (14 Nov 2026): the bank reconciliation record the auditor can see. ONE insert-only table, two kinds of row.
--
-- ⚠️ NOT RUN anywhere · Athi runs it (Supabase SQL editor, AS postgres), after SIT has run it. Safe to repeat (IF NOT EXISTS / DROP ... IF EXISTS first). It touches no row and
--    no existing table: a new table nothing reads until FIN-70's routes meet it, and they check schema.hasTable first, so the api is correct BEFORE and AFTER this file runs
--    (before: GET and POST /api/books/bank/marks · /bank/statements · /bank/log answer a plain "arrives after the next update"; the page keeps its marks on the device and says so).
-- NUMBER. api main ends at b859; open PR 1302 (ACC-176) holds b863 → b864 is the next free one (checked 2026-11-14).
-- DESIGN. docs/16-finance/FIN-70-CRITIC.md (verdict CHANGE). kind = 'mark': the engine's own step action (CBBankRecon.step: accept | undo | note | attach) on one statement line;
--    the web replays the rows oldest first through the SAME step, newest wins per line key. No second calculation. kind = 'statement': the BRS snapshot the page already shows
--    (opening, closing per bank, closing per books, difference, currency, the statement file's HASH): carried, never recomputed. A re-sign or an undo is a NEW row.
--    made_by and made_at are stamped by the server (the session and its own clock), never the client. Never stored: a statement line, a narration, the file name.
--    attach_ref is the reference the page gives an attached file (its hash or id), not the name.
-- OWNER: lib/bank-rec-log.js (validate, append, read, the cross-check); routes/books.js only reads the request.
-- ROLL BACK (before the build ships it loses nothing; after, the shared record is gone, the device copy stays):
--    DROP TABLE IF EXISTS bank_rec_log;
-- CHECK (read-only, one row):   SELECT count(*) FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'bank_rec_log';   Expect 1.
-- RLS: ENABLE + FORCE + the one entity policy (as books_counter). cb_app may SELECT and INSERT only; no UPDATE and no DELETE grant, and public.books_insert_only() (b273) refuses both
--    for any role that has the right anyway.

CREATE TABLE IF NOT EXISTS bank_rec_log (
  id                   uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  seq                  bigint      GENERATED ALWAYS AS IDENTITY, -- the log's order: made_at is one value for a whole batch, seq is the order inside it
  entity_id            uuid        NOT NULL,
  account_id           uuid        NOT NULL,
  kind                 text        NOT NULL CHECK (kind IN ('mark', 'statement')),
  line_key             text        CHECK (line_key IS NULL OR char_length(line_key) BETWEEN 1 AND 200),
  act                  text        CHECK (act IS NULL OR act IN ('accept', 'undo', 'note', 'attach')),
  how                  text        CHECK (how IS NULL OR char_length(how) <= 40),
  entry_ids            text[]      NOT NULL DEFAULT '{}' CHECK (cardinality(entry_ids) <= 50),
  chit_ids             text[]      NOT NULL DEFAULT '{}' CHECK (cardinality(chit_ids) <= 50),
  note                 text        CHECK (note IS NULL OR char_length(note) BETWEEN 1 AND 500),
  attach_ref           text        CHECK (attach_ref IS NULL OR char_length(attach_ref) BETWEEN 1 AND 200),
  file_hash            text        CHECK (file_hash IS NULL OR char_length(file_hash) BETWEEN 1 AND 128),
  period_from          date,
  period_to            date,
  opening_minor        bigint,
  closing_bank_minor   bigint,
  closing_books_minor  bigint,
  difference_minor     bigint,
  currency             text        CHECK (currency IS NULL OR currency ~ '^[A-Z]{3}$'),
  tied                 boolean,
  made_by              uuid,
  made_at              timestamptz NOT NULL DEFAULT now(),
  -- a mark names its line and its action; a statement names its period, its four figures and their currency: never half of either
  CONSTRAINT bank_rec_log_mark_chk CHECK (kind <> 'mark' OR (line_key IS NOT NULL AND act IS NOT NULL
      AND period_from IS NULL AND period_to IS NULL AND opening_minor IS NULL AND closing_bank_minor IS NULL
      AND closing_books_minor IS NULL AND difference_minor IS NULL AND currency IS NULL AND tied IS NULL)),
  CONSTRAINT bank_rec_log_statement_chk CHECK (kind <> 'statement' OR (line_key IS NULL AND act IS NULL AND note IS NULL AND attach_ref IS NULL
      AND period_from IS NOT NULL AND period_to IS NOT NULL AND period_to >= period_from AND opening_minor IS NOT NULL AND closing_bank_minor IS NOT NULL
      AND closing_books_minor IS NOT NULL AND difference_minor IS NOT NULL AND currency IS NOT NULL AND tied IS NOT NULL)),
  CONSTRAINT bank_rec_log_note_chk CHECK ((act = 'note') = (note IS NOT NULL)),
  CONSTRAINT bank_rec_log_attach_chk CHECK ((act = 'attach') = (attach_ref IS NOT NULL)));
-- WHY: every read is one account of one shop, in time order (entity_id leads for RLS); the primary key cannot serve it
CREATE INDEX IF NOT EXISTS bank_rec_log_account_idx ON bank_rec_log (entity_id, account_id, seq);

ALTER TABLE bank_rec_log ENABLE ROW LEVEL SECURITY;  ALTER TABLE bank_rec_log FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS rls_entity ON bank_rec_log;
CREATE POLICY rls_entity ON bank_rec_log
  USING (entity_id = NULLIF(current_setting('app.current_entity', true), '')::uuid)
  WITH CHECK (entity_id = NULLIF(current_setting('app.current_entity', true), '')::uuid);

-- insert-only, the books' own pattern: the trigger refuses UPDATE and DELETE for every role (and the grant below never gave them to cb_app)
DROP TRIGGER IF EXISTS bank_rec_log_insert_only ON bank_rec_log;
CREATE TRIGGER bank_rec_log_insert_only BEFORE UPDATE OR DELETE ON bank_rec_log FOR EACH ROW EXECUTE FUNCTION public.books_insert_only();

REVOKE ALL ON bank_rec_log FROM cb_app, cb_backup;
GRANT SELECT, INSERT ON bank_rec_log TO cb_app;
GRANT SELECT ON bank_rec_log TO cb_backup;
COMMENT ON TABLE bank_rec_log IS 'FIN-70: the bank reconciliation record, insert-only. kind mark = a step action (accept, undo, note, attach) on a statement line, replayed newest-wins; kind statement = the signed BRS figures with their currency and the file hash. Never a statement line or the file itself.';
