-- b875_books_review_baseline.sql — AUDITOR RANK 10 "changed since my last check" (17 Nov 2026): the baseline an auditor sets per client ("Mark as checked"), two read indexes, nothing else.
--
-- ⚠️ NOT RUN anywhere · Athi runs it (Supabase SQL editor, AS postgres), SIT first through the box's migrate step. Safe to repeat (IF NOT EXISTS, DROP ... IF EXISTS first). New table + two indexes; no row of any old table is touched.
-- The api is correct BEFORE and AFTER this file runs: before it, the Home count falls back to the grant start and "Mark as checked" answers 503 BOOKS_BASELINE_NOT_MIGRATED in words (never a 500).
-- NUMBER. b874 is the last file in the integration worktree; renumber before landing if another round took b875 (critic: PM/CRITIC-REQ-AUDITOR-BANK-AND-CHANGES-2026-11-17.md).
-- WHAT IT DOES.
--    books_review_baseline   insert-only, in the FIRM's entity (entity_id = the firm, never the client's): one row per "Mark as checked" act of one real person (identity_id) on one client (client_entity).
--                            seen_to = the watermark of what the screen showed (the newest journal_entry.created_at it listed, else the read's own server time), sent back by the page and refused when in the future;
--                            made_at = the server clock at the act. The baseline of a (person, client) is its greatest seen_to (a stale tab cannot move it back); it is keyed on person and client, NOT on the grant, so a renewed grant keeps it.
--                            It is NOT review_mark (that lives in the CLIENT's entity and the client's session reads it) and NOT a look-log row (the client reads those): the client never sees this table.
--                            PER PERSON IN THE DATABASE: the one policy holds the firm's entity AND the person: identity_id = app.current_actor (set on every request transaction, db/index.js withEntity, as chit_reads_own does). The firm owner's session reads and writes only its own rows, never an assistant's; a job with no actor sees none.
--                            The api reads under the REAL caller as actor (an auditor request runs as the client's synthetic identity, so lib/books-baseline wraps its firm-side reads in reqctx.runWithActor(real person)).
--    journal_entry_created_idx      (entity_id, created_at): "entries posted after T" is one range read per client (the practice count and the Day book filter). WHY: the only index on journal_entry leads entity_id, posting_date.
--    books_access_log_look_idx      partial, only the allowed looks that are not the list read: the corrected Last look is a max(at) over a pair's real looks, and the list read writes one row per client on every Home read.
-- OWNER: lib/books-baseline.js (the writer and the readers). Purge/erasure routines: the firm's entity owns the rows (they leave with the firm); cb-db lists the table there.
-- LOCK COST: CREATE INDEX (not CONCURRENTLY, so the file stays one transaction) takes a SHARE lock: writes to journal_entry and books_access_log wait while it builds. cb-db decides whether to run the two index lines off-peak (they are independent of the table).
-- ROLL BACK (nothing else depends on them):
--    DROP INDEX IF EXISTS books_access_log_look_idx; DROP INDEX IF EXISTS journal_entry_created_idx; DROP TABLE IF EXISTS books_review_baseline;
-- CHECK (read-only, all-true block; every row must read ok = true):
--    SELECT 'table exists' AS what, count(*) = 1 AS ok FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'books_review_baseline'
--    UNION ALL SELECT 'RLS enabled and forced', count(*) = 1 FROM pg_class WHERE oid = 'public.books_review_baseline'::regclass AND relrowsecurity AND relforcerowsecurity
--    UNION ALL SELECT 'entity policy', count(*) = 1 FROM pg_policies WHERE tablename = 'books_review_baseline' AND policyname = 'rls_entity'
--    UNION ALL SELECT 'cb_app has no UPDATE or DELETE', count(*) = 0 FROM information_schema.role_table_grants WHERE table_name = 'books_review_baseline' AND grantee = 'cb_app' AND privilege_type IN ('UPDATE', 'DELETE')
--    UNION ALL SELECT 'two indexes', count(*) = 2 FROM pg_indexes WHERE indexname IN ('journal_entry_created_idx', 'books_access_log_look_idx');
-- RLS: ENABLE + FORCE + the one policy on entity AND actor (b864's entity policy plus chit_reads_own's actor test). cb_app may SELECT and INSERT only; books_insert_only() refuses UPDATE and DELETE for every role. cb_backup may SELECT.

BEGIN;
SET LOCAL lock_timeout = '5s';

CREATE TABLE IF NOT EXISTS books_review_baseline (
  baseline_id   bigint      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  entity_id     uuid        NOT NULL,  -- the FIRM (the auditor's own business), never the client
  client_entity uuid        NOT NULL,  -- the client whose books were checked
  identity_id   uuid        NOT NULL,  -- the real person who said "checked"
  seen_to       timestamptz NOT NULL,  -- the watermark of what the screen showed; never after the server clock at the act
  made_at       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT books_review_baseline_seen_chk CHECK (seen_to <= made_at),
  CONSTRAINT books_review_baseline_client_chk CHECK (client_entity <> entity_id));
-- WHY: the caller's baselines for every client are ONE read (entity, person, newest first); the latest per client is picked in the statement
CREATE INDEX IF NOT EXISTS books_review_baseline_person_idx ON books_review_baseline (entity_id, identity_id, client_entity, baseline_id DESC);

ALTER TABLE books_review_baseline ENABLE ROW LEVEL SECURITY;  ALTER TABLE books_review_baseline FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS rls_entity ON books_review_baseline;
CREATE POLICY rls_entity ON books_review_baseline
  USING (entity_id = NULLIF(current_setting('app.current_entity', true), '')::uuid AND identity_id = NULLIF(current_setting('app.current_actor', true), '')::uuid)
  WITH CHECK (entity_id = NULLIF(current_setting('app.current_entity', true), '')::uuid AND identity_id = NULLIF(current_setting('app.current_actor', true), '')::uuid);

-- insert-only, the books' own pattern: the trigger refuses UPDATE and DELETE for every role (and the grant below never gave them to cb_app)
DROP TRIGGER IF EXISTS books_review_baseline_insert_only ON books_review_baseline;
CREATE TRIGGER books_review_baseline_insert_only BEFORE UPDATE OR DELETE ON books_review_baseline FOR EACH ROW EXECUTE FUNCTION public.books_insert_only();

REVOKE ALL ON books_review_baseline FROM cb_app, cb_backup;
REVOKE UPDATE, DELETE, TRUNCATE ON books_review_baseline FROM cb_app;  -- stated again beside the GRANT: migration-lint reads an insert-only GRANT with this exact REVOKE
GRANT SELECT, INSERT ON books_review_baseline TO cb_app;
GRANT SELECT ON books_review_baseline TO cb_backup;
COMMENT ON TABLE books_review_baseline IS 'Auditor rank 10: one "Mark as checked" act of one person on one client (firm entity). Latest row per (person, client) is the baseline for the "changed since my last check" count; insert-only; never shown to the client.';

-- "entries posted after T" per client, for the Home count and the Day book filter
CREATE INDEX IF NOT EXISTS journal_entry_created_idx ON journal_entry (entity_id, created_at);
-- the corrected Last look: only real, allowed looks (not the list read) of one person on one client
CREATE INDEX IF NOT EXISTS books_access_log_look_idx ON books_access_log (grantee_entity, grantor_entity, actor_identity_id, at DESC) WHERE route_pattern <> 'GET /practice' AND outcome = 'allowed';

COMMIT;
