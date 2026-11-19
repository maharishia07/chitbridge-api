-- b876_private_flag.sql — PRIVATE BOOKMARKS AND NOTES (17 Nov 2026), slice M1: one table, private_flag, in the WRITER's organisation, with a second wall for "Only me".
--
-- ⚠️ NOT RUN anywhere · Athi runs it (Supabase SQL editor, AS postgres), SIT first through the box's migrate step. Safe to repeat (IF NOT EXISTS, DROP ... IF EXISTS first). New table; no row of any old table is touched.
-- The api is correct BEFORE and AFTER this file runs: until it runs, every /api/flags route answers 503 FLAGS_NOT_MIGRATED in words (never a 500).
-- NUMBER. b875 is rank 10's (books_review_baseline, uncommitted on the rank 10 lane); this file takes b876. Renumber before landing if another round took it.
-- WHAT IT IS (docs PM/REQ-PRIVATE-NOTES-BOOKMARKS-2026-11-17.md, amended per critic 9a26ad3c; PM/CRITIC-REQ-PRIVATE-NOTES-BOOKMARKS-2026-11-17.md "Build brief · migration").
--    private_flag   one row per bookmark or note a person puts on a record (v1 subjects: a posting, a client). entity_id = the WRITER's own organisation (the firm, never the client), so the client never reads it.
--                   The row carries only a pointer (subject_kind, subject_entity, subject_id) and a short label the PAGE sent; never a copy of the client's figures.
--                   `note` is the words (the API cap is 1,000; this column holds 4,000 as the backstop). REMOVING a flag sets state = 'removed', removed_by / removed_at and note = NULL: the words are gone, who and when stay.
--                   The row IS the removal record (critic finding 6): no second log. cb_app has no DELETE; the trigger below refuses a change to a removed row.
--    thread_id      minted with the row, ready for slice A4 (replies in chit_messages with subject_type 'flag'); NOT used by this file. ⚠️ A4's migration widens chit_messages_subject_ck; never re-run b868 after that file.
-- RLS: ENABLE + FORCE. TWO WALLS (critic finding 1; app.current_actor is set on every transaction, db/index.js withEntity, as chit_reads_own uses it):
--    1. the organisation:  entity_id = app.current_entity
--    2. "Only me":         visibility = 'org' OR author_identity_id = app.current_actor.  A blank actor (a job, a script) sees NO "Only me" row: it fails closed.
--    INSERT also needs author_identity_id = app.current_actor (you cannot write a row in someone else's name). UPDATE: the same rule as SELECT, on both the old and the new row.
-- TRIGGER private_flag_guard (every role but a superuser may not delete): refuses DELETE · a change of entity_id, author_identity_id, subject_kind, subject_entity, subject_id, kind, created_at, thread_id, seat · any change to a removed row · visibility 'org' -> 'me'.
--    (A superuser may delete: the test-entity purge routine, run by Athi as postgres, clears this table with the rest. cb_app has no DELETE privilege either way.)
-- PURGE ROUTINE: migrations/purge_test_entities_ROUTINE.sql finds tables by their entity_id column, so this table is in it without being named; its header says so.
-- A PERSON LEAVES: the rows are KEPT and become unreadable ("Only me" rows have an author who no longer signs in); nothing is purged (Athi, 17 Nov). cb-db's census counts them.
-- OWNER: lib/private-flag.js (the only file that may name this table; tests/private-flag-isolation.realstack.cjs holds the guard) · routes/flags.js.
-- ROLL BACK (loses every flag; the records flagged are untouched):
--    DROP TABLE IF EXISTS private_flag;   DROP FUNCTION IF EXISTS public.private_flag_guard();
-- CHECK (read-only, all-true block; every row must read ok = true):
--    SELECT 'table exists' AS what, count(*) = 1 AS ok FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'private_flag'
--    UNION ALL SELECT 'RLS enabled and forced', count(*) = 1 FROM pg_class WHERE oid = 'public.private_flag'::regclass AND relrowsecurity AND relforcerowsecurity
--    UNION ALL SELECT 'three policies', count(*) = 3 FROM pg_policies WHERE tablename = 'private_flag'
--    UNION ALL SELECT 'the policies name the actor', count(*) = 3 FROM pg_policies WHERE tablename = 'private_flag' AND (qual LIKE '%current_actor%' OR with_check LIKE '%current_actor%')
--    UNION ALL SELECT 'cb_app: select, insert, update only', has_table_privilege('cb_app', 'public.private_flag', 'SELECT') AND has_table_privilege('cb_app', 'public.private_flag', 'INSERT') AND has_table_privilege('cb_app', 'public.private_flag', 'UPDATE') AND NOT has_table_privilege('cb_app', 'public.private_flag', 'DELETE') AND NOT has_table_privilege('cb_app', 'public.private_flag', 'TRUNCATE')
--    UNION ALL SELECT 'guard trigger', count(*) = 1 FROM pg_trigger WHERE tgrelid = 'public.private_flag'::regclass AND tgname = 'private_flag_guard';

BEGIN;
SET LOCAL lock_timeout = '5s';

CREATE TABLE IF NOT EXISTS private_flag (
  flag_id            bigint      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  entity_id          uuid        NOT NULL,  -- the WRITER's organisation (a firm, an accountant, a business), never the client's
  kind               text        NOT NULL CHECK (kind IN ('bookmark', 'note')),
  visibility         text        NOT NULL CHECK (visibility IN ('org', 'me')),
  subject_kind       text        NOT NULL CHECK (length(subject_kind) BETWEEN 1 AND 40),  -- lib/mark-adopters SUBJECTS: 'posting', 'client' (the list grows by slice, so no enumerated CHECK here)
  subject_entity     uuid        NOT NULL,  -- the client whose record it is, or the writer's own organisation
  subject_id         text        NOT NULL CHECK (length(subject_id) BETWEEN 1 AND 120),
  label              text        NOT NULL CHECK (length(label) BETWEEN 1 AND 80),
  note               text        CHECK (note IS NULL OR length(note) <= 4000),
  thread_id          uuid        NOT NULL DEFAULT gen_random_uuid(),
  state              text        NOT NULL DEFAULT 'open' CHECK (state IN ('open', 'resolved', 'removed')),
  author_identity_id uuid        NOT NULL,
  author_name        text,
  seat               text        NOT NULL CHECK (length(seat) BETWEEN 1 AND 30),  -- 'auditor' | 'adviser' (the grant the writer used) | 'business' (own books)
  resolved_by        uuid,
  resolved_name      text,
  resolved_at        timestamptz,
  removed_by         uuid,
  removed_name       text,
  removed_at         timestamptz,
  created_at         timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT private_flag_note_words  CHECK (kind <> 'note' OR state = 'removed' OR length(btrim(COALESCE(note, ''))) > 0),
  CONSTRAINT private_flag_bookmark_bare CHECK (kind <> 'bookmark' OR note IS NULL),
  CONSTRAINT private_flag_removed_clean CHECK (state <> 'removed' OR (note IS NULL AND removed_at IS NOT NULL AND removed_by IS NOT NULL)),
  CONSTRAINT private_flag_resolved_said CHECK (state <> 'resolved' OR (resolved_at IS NOT NULL AND resolved_by IS NOT NULL)));

-- the read: one organisation's flags of one client, newest state first (every list page asks it once, ids in the body)
CREATE INDEX IF NOT EXISTS private_flag_read_idx ON private_flag (entity_id, subject_entity, state, subject_kind, subject_id);
-- one OPEN shared bookmark per record, and one OPEN "Only me" bookmark per record per person (a stale tab sending the same 30 again adds nothing)
CREATE UNIQUE INDEX IF NOT EXISTS private_flag_org_bookmark_uq ON private_flag (entity_id, subject_kind, subject_entity, subject_id) WHERE kind = 'bookmark' AND state = 'open' AND visibility = 'org';
CREATE UNIQUE INDEX IF NOT EXISTS private_flag_me_bookmark_uq ON private_flag (entity_id, subject_kind, subject_entity, subject_id, author_identity_id) WHERE kind = 'bookmark' AND state = 'open' AND visibility = 'me';

ALTER TABLE private_flag ENABLE ROW LEVEL SECURITY;  ALTER TABLE private_flag FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS private_flag_read ON private_flag;
CREATE POLICY private_flag_read ON private_flag FOR SELECT
  USING (entity_id = NULLIF(current_setting('app.current_entity', true), '')::uuid
     AND (visibility = 'org' OR author_identity_id = NULLIF(current_setting('app.current_actor', true), '')::uuid));
DROP POLICY IF EXISTS private_flag_insert ON private_flag;
CREATE POLICY private_flag_insert ON private_flag FOR INSERT
  WITH CHECK (entity_id = NULLIF(current_setting('app.current_entity', true), '')::uuid
          AND author_identity_id = NULLIF(current_setting('app.current_actor', true), '')::uuid);
DROP POLICY IF EXISTS private_flag_update ON private_flag;
CREATE POLICY private_flag_update ON private_flag FOR UPDATE
  USING (entity_id = NULLIF(current_setting('app.current_entity', true), '')::uuid
     AND (visibility = 'org' OR author_identity_id = NULLIF(current_setting('app.current_actor', true), '')::uuid))
  WITH CHECK (entity_id = NULLIF(current_setting('app.current_entity', true), '')::uuid
     AND (visibility = 'org' OR author_identity_id = NULLIF(current_setting('app.current_actor', true), '')::uuid));

CREATE OR REPLACE FUNCTION public.private_flag_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF (SELECT rolsuper FROM pg_roles WHERE rolname = current_user) THEN RETURN OLD; END IF;
    RAISE EXCEPTION 'private_flag: a flag is never deleted, it is removed (state = removed)' USING ERRCODE = '42501';
  END IF;
  IF OLD.state = 'removed' THEN RAISE EXCEPTION 'private_flag: a removed flag cannot change' USING ERRCODE = 'P0001'; END IF;
  IF NEW.entity_id IS DISTINCT FROM OLD.entity_id OR NEW.author_identity_id IS DISTINCT FROM OLD.author_identity_id
     OR NEW.subject_kind IS DISTINCT FROM OLD.subject_kind OR NEW.subject_entity IS DISTINCT FROM OLD.subject_entity
     OR NEW.subject_id IS DISTINCT FROM OLD.subject_id OR NEW.kind IS DISTINCT FROM OLD.kind
     OR NEW.created_at IS DISTINCT FROM OLD.created_at OR NEW.thread_id IS DISTINCT FROM OLD.thread_id OR NEW.seat IS DISTINCT FROM OLD.seat THEN
    RAISE EXCEPTION 'private_flag: who, what and where of a flag never change' USING ERRCODE = '42501';
  END IF;
  IF OLD.visibility = 'org' AND NEW.visibility = 'me' THEN RAISE EXCEPTION 'private_flag: a shared flag cannot be taken back to Only me' USING ERRCODE = 'P0001'; END IF;
  RETURN NEW;
END; $$;
DROP TRIGGER IF EXISTS private_flag_guard ON private_flag;
CREATE TRIGGER private_flag_guard BEFORE UPDATE OR DELETE ON private_flag FOR EACH ROW EXECUTE FUNCTION public.private_flag_guard();

REVOKE ALL ON private_flag FROM cb_app, cb_backup;
GRANT SELECT, INSERT, UPDATE ON private_flag TO cb_app;
GRANT SELECT ON private_flag TO cb_backup;
COMMENT ON TABLE private_flag IS 'Private bookmarks and notes: one row per flag in the WRITER''s organisation (never the client''s); "Only me" held by a policy on app.current_actor; never deleted, removal sets state = removed and clears the words.';

COMMIT;
