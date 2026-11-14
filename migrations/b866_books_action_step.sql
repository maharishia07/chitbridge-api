-- b866_books_action_step.sql — ACC-176b (14 Nov 2026): MAKER-CHECKER for an adviser firm acting in a store's books. One INSERT-ONLY table of steps: prepared, reviewed, returned, accepted, withdrawn.
--
-- ⚠️ NOT RUN anywhere · Athi runs it (Supabase SQL editor, AS postgres), SIT first, AFTER b863 and b865 (it reads books_access_grant and its preset). Safe to repeat (IF NOT EXISTS / DROP ... IF EXISTS first).
--    It touches no existing row. The api is correct BEFORE and AFTER this file runs: until it runs, every action route answers 503 BOOKS_ACTION_NOT_SWITCHED_ON in words and nothing is written.
-- NUMBER. b863 ACC-176, b864 FIN-70, b865 ACC-176b (the grant), b866 this one (checked 2026-11-14 across origin). Rename before landing if another round took it.
-- WHY A NEW TABLE (critic 2, 14 Nov): chit_proposal is one row per entity COPY (b796 rls_entity), needs a chit and the cross-installation event path, and its columns are money-free by design; journal_entry is insert-only
--    (books_insert_only trigger), so an entry cannot wait there as a draft that later changes status. There is no existing place to keep a prepared, unposted books action. The status of an action is its LATEST step; nothing is updated.
-- WHAT IT IS.
--    books_action_step  one row per step of an action: action_id, store (the books' owner), step, kind (journal, reverse, lock, unlock, year_close), body (first step only: exactly what the owner's own door would take),
--                       body_hash (every later step carries the hash of the body it saw: a changed body is a new action), total_minor + currency (the pair the preview showed), action_ref, who (identity, name), the firm's name,
--                       role (maker, checker, owner, system), reason (a return and a withdrawal say why), grant_id, entry_id (set on `accepted`: the entry the existing writer posted).
--                       Each step happens at most once per action (unique index). The posted entry is linked back through journal_entry.source_ref = 'action:<action_id>' (no new column there).
--    RLS: ENABLE + FORCE. SELECT: the store's own rows. INSERT: the firm's steps (prepared, reviewed, returned by a checker) only WITH a live ADVISER grant of this store named by grant_id; the owner's steps (accepted, returned, withdrawn)
--         for the store itself. No UPDATE, no DELETE for cb_app, and the books_insert_only() trigger refuses both for every role.
-- money-group: currency covers total_minor
-- OWNER: lib/books-action.js (prepare, review, return, accept, withdraw) · routes/books-actions.js.
-- ROLL BACK (loses the queue and its history; the books themselves are untouched, because an accepted action already posted through the normal writer):
--    DROP TABLE IF EXISTS books_action_step;
-- CHECK (read-only, all-true multi-row block; every row must read ok = true):
--    SELECT 'table exists, forced RLS' AS what, (SELECT relrowsecurity AND relforcerowsecurity FROM pg_class WHERE relname = 'books_action_step') AS ok
--    UNION ALL SELECT 'insert-only trigger', EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = 'public.books_action_step'::regclass AND tgname = 'books_action_step_insert_only')
--    UNION ALL SELECT 'cb_app: no UPDATE, no DELETE', NOT has_table_privilege('cb_app', 'public.books_action_step', 'UPDATE') AND NOT has_table_privilege('cb_app', 'public.books_action_step', 'DELETE')
--    UNION ALL SELECT 'each step once per action', EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'books_action_step_once_uq');
-- RLS: stated above (ENABLE + FORCE; select by store; insert by the firm with a live adviser grant, or by the owner for its own store).

BEGIN;
SET LOCAL lock_timeout = '5s';

CREATE TABLE IF NOT EXISTS books_action_step (
  step_id           bigint      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  action_id         uuid        NOT NULL,
  store             uuid        NOT NULL,
  step              text        NOT NULL CHECK (step IN ('prepared', 'reviewed', 'returned', 'accepted', 'withdrawn')),
  kind              text        NOT NULL CHECK (kind IN ('journal', 'reverse', 'lock', 'unlock', 'year_close')),
  body              jsonb,
  body_hash         text        NOT NULL,
  total_minor       bigint,
  currency          text        CHECK (currency IS NULL OR currency ~ '^[A-Z]{3}$'),
  action_ref        text,
  actor_identity_id uuid        NOT NULL,
  actor_name        text,
  firm_name         text,
  role              text        NOT NULL CHECK (role IN ('maker', 'checker', 'owner', 'system')),
  reason            text,
  grant_id          uuid,
  entry_id          uuid,
  at                timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT books_action_step_body_first CHECK ((step = 'prepared') = (body IS NOT NULL)));
-- WHY: a step happens once per action (a second review or a second accept is refused by the database, not only by the api)
CREATE UNIQUE INDEX IF NOT EXISTS books_action_step_once_uq ON books_action_step (action_id, step);
-- WHY: the queue of a store reads its newest steps; an open action_ref is looked up before a second prepare
CREATE INDEX IF NOT EXISTS books_action_step_store_idx ON books_action_step (store, at DESC);
CREATE INDEX IF NOT EXISTS books_action_step_ref_idx ON books_action_step (store, action_ref) WHERE action_ref IS NOT NULL;

ALTER TABLE books_action_step ENABLE ROW LEVEL SECURITY;  ALTER TABLE books_action_step FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS action_read ON books_action_step;
CREATE POLICY action_read ON books_action_step FOR SELECT
  USING (store = NULLIF(current_setting('app.current_entity', true), '')::uuid);
-- the firm's steps: only inside the store's own scope, naming a LIVE adviser grant of this store (not revoked, not expired)
DROP POLICY IF EXISTS action_insert_firm ON books_action_step;
CREATE POLICY action_insert_firm ON books_action_step FOR INSERT
  WITH CHECK (store = NULLIF(current_setting('app.current_entity', true), '')::uuid
    AND step IN ('prepared', 'reviewed', 'returned') AND role IN ('maker', 'checker')
    AND EXISTS (SELECT 1 FROM books_access_grant g WHERE g.grant_id = books_action_step.grant_id AND g.grantor_entity = books_action_step.store
                AND g.preset = 'adviser' AND g.revoked_at IS NULL AND g.expires_at > now()));
-- the owner's steps: its own store, never naming a firm role
DROP POLICY IF EXISTS action_insert_owner ON books_action_step;
CREATE POLICY action_insert_owner ON books_action_step FOR INSERT
  WITH CHECK (store = NULLIF(current_setting('app.current_entity', true), '')::uuid
    AND step IN ('accepted', 'returned', 'withdrawn') AND role IN ('owner', 'system'));

DROP TRIGGER IF EXISTS books_action_step_insert_only ON books_action_step;
CREATE TRIGGER books_action_step_insert_only BEFORE UPDATE OR DELETE ON books_action_step FOR EACH ROW EXECUTE FUNCTION public.books_insert_only();

REVOKE ALL ON books_action_step FROM cb_app, cb_backup;
GRANT SELECT, INSERT ON books_action_step TO cb_app;
REVOKE UPDATE, DELETE ON books_action_step FROM cb_app;
GRANT SELECT ON books_action_step TO cb_backup;
COMMENT ON TABLE books_action_step IS 'ACC-176b: maker-checker steps of an adviser firm acting in a store''s books (prepared, reviewed, returned, accepted, withdrawn); insert-only; the latest step is the status';
COMMIT;
