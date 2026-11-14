-- b863_books_access_grant.sql — ACC-176 (14 Nov 2026): a member store's OWNER lets the network parent READ its books, one grant per pair, with every look recorded.
--
-- ⚠️ NOT RUN anywhere · Athi runs it (Supabase SQL editor, AS postgres), SIT first. Safe to repeat (IF NOT EXISTS / DROP ... IF EXISTS first). It touches no row of any existing table except to WIDEN
--    access_events_action_check (every value allowed before is allowed after). The api is correct BEFORE and AFTER this file runs: until it runs, an auditor's request answers 503
--    BOOKS_GRANT_NOT_SWITCHED_ON in words ("Access for your auditor is not switched on yet") and a member's own books are untouched (lib/books-grant.js checks the table, never a 500).
-- NUMBER. api main ends at b859; open PRs hold b860, b861, b862 as RUN files (checked 2026-11-14) → b863 is the next free one. Rename before landing if another round took it.
-- LOOKED AT (DISCIPLINES 4a): access_events (the change log of who gave whom which access: grant and revoke are three new actions there, before and after); cb_edge (READ ONLY here: the grant is live
--    only while an active, non-suspended edge makes the grantee the network parent of the grantor, lib/network-membership isMemberSql); till_invoice_lease b858 (the entity-policy pattern).
-- WHAT IT IS.
--    books_access_grant  one row per grant: grantor_entity (the member, who owns the books), grantee_entity (the parent, who reads), preset (v1: 'auditor' only), can_see_costs, purpose (required words),
--                        granted_by, granted_at, expires_at (required; the api defaults it to 12 months), revoked_at / revoked_by. ONE OPEN GRANT PER PAIR (partial unique index).
--                        RLS: a row is VISIBLE to its grantor and its grantee (the parent finds its grants under its own binding), but only the GRANTOR writes it.
--    books_access_log    one row per request a grantee makes on a member's books, allowed or refused: no row bodies. INSERT-ONLY (no UPDATE, no DELETE privilege, no policy for them).
--                        RLS: the grantee inserts its own looks; the grantor reads every look at its books. The write FAILS CLOSED in the api: no log row, no read.
--    access_events       action also allows 'books_grant_given', 'books_grant_changed', 'books_grant_revoked'.
-- OWNER: lib/books-grant.js (the grant, the revoke and the log of looks); middleware/books-grant.js reads it on every request that names a member's books.
-- ROLL BACK (before the build ships it loses nothing; after, the grants and the log of looks are lost, the books themselves are untouched):
--    DROP TABLE IF EXISTS books_access_log; DROP TABLE IF EXISTS books_access_grant;
--    (the access_events constraint stays widened; narrowing it is refused while a books_grant_* row exists)
-- CHECK (read-only, one row):  SELECT count(*) FROM information_schema.tables WHERE table_schema = 'public' AND table_name IN ('books_access_grant', 'books_access_log');   Expect 2.
-- RLS: both tables ENABLE + FORCE. cb_app: grant = SELECT, INSERT, UPDATE (a revoke and an expiry edit are updates; no DELETE: a grant is a record); log = SELECT, INSERT only.

BEGIN;
SET LOCAL lock_timeout = '5s';

CREATE TABLE IF NOT EXISTS books_access_grant (
  grant_id       uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  grantor_entity uuid        NOT NULL,
  grantee_entity uuid        NOT NULL,
  preset         text        NOT NULL DEFAULT 'auditor' CHECK (preset = 'auditor'),
  can_see_costs  boolean     NOT NULL DEFAULT true,
  purpose        text        NOT NULL CHECK (length(btrim(purpose)) BETWEEN 3 AND 300),
  granted_by     uuid        NOT NULL,
  granted_at     timestamptz NOT NULL DEFAULT now(),
  expires_at     timestamptz NOT NULL,
  revoked_at     timestamptz,
  revoked_by     uuid,
  CONSTRAINT books_access_grant_not_self CHECK (grantor_entity <> grantee_entity),
  CONSTRAINT books_access_grant_expiry CHECK (expires_at > granted_at));
-- WHY: one open grant per pair; the lookup of every request (grantee, grantor) hits it
CREATE UNIQUE INDEX IF NOT EXISTS books_access_grant_open_uq ON books_access_grant (grantee_entity, grantor_entity) WHERE revoked_at IS NULL;
CREATE INDEX IF NOT EXISTS books_access_grant_grantor_idx ON books_access_grant (grantor_entity, granted_at DESC);

ALTER TABLE books_access_grant ENABLE ROW LEVEL SECURITY;  ALTER TABLE books_access_grant FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS grant_read ON books_access_grant;
CREATE POLICY grant_read ON books_access_grant FOR SELECT
  USING (grantor_entity = NULLIF(current_setting('app.current_entity', true), '')::uuid
      OR grantee_entity = NULLIF(current_setting('app.current_entity', true), '')::uuid);
DROP POLICY IF EXISTS grant_insert ON books_access_grant;
CREATE POLICY grant_insert ON books_access_grant FOR INSERT
  WITH CHECK (grantor_entity = NULLIF(current_setting('app.current_entity', true), '')::uuid);
DROP POLICY IF EXISTS grant_update ON books_access_grant;
CREATE POLICY grant_update ON books_access_grant FOR UPDATE
  USING (grantor_entity = NULLIF(current_setting('app.current_entity', true), '')::uuid)
  WITH CHECK (grantor_entity = NULLIF(current_setting('app.current_entity', true), '')::uuid);

CREATE TABLE IF NOT EXISTS books_access_log (
  log_id            bigint      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  at                timestamptz NOT NULL DEFAULT now(),
  grant_id          uuid,
  grantor_entity    uuid        NOT NULL,
  grantee_entity    uuid        NOT NULL,
  actor_identity_id uuid,
  route_pattern     text        NOT NULL,
  query_shape       text,
  status            integer     NOT NULL,
  outcome           text        NOT NULL);
-- WHY: the member's "who looked at my books" list reads its own rows newest first
CREATE INDEX IF NOT EXISTS books_access_log_grantor_idx ON books_access_log (grantor_entity, at DESC);

ALTER TABLE books_access_log ENABLE ROW LEVEL SECURITY;  ALTER TABLE books_access_log FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS log_read ON books_access_log;
CREATE POLICY log_read ON books_access_log FOR SELECT
  USING (grantor_entity = NULLIF(current_setting('app.current_entity', true), '')::uuid
      OR grantee_entity = NULLIF(current_setting('app.current_entity', true), '')::uuid);
DROP POLICY IF EXISTS log_insert ON books_access_log;
CREATE POLICY log_insert ON books_access_log FOR INSERT
  WITH CHECK (grantee_entity = NULLIF(current_setting('app.current_entity', true), '')::uuid);

REVOKE ALL ON books_access_grant FROM cb_app, cb_backup;
REVOKE ALL ON books_access_log FROM cb_app, cb_backup;
GRANT SELECT, INSERT, UPDATE ON books_access_grant TO cb_app;
GRANT SELECT, INSERT ON books_access_log TO cb_app;
REVOKE UPDATE, DELETE ON books_access_log FROM cb_app;
GRANT SELECT ON books_access_grant TO cb_backup;
GRANT SELECT ON books_access_log TO cb_backup;
COMMENT ON TABLE books_access_grant IS 'ACC-176: the member owner lets its network parent read its books (read-only, purpose and expiry required); live only while an active edge makes the grantee the parent';
COMMENT ON TABLE books_access_log IS 'ACC-176: one row per request on another business''s books, allowed or refused, no row bodies; insert-only';

ALTER TABLE access_events DROP CONSTRAINT IF EXISTS access_events_action_check;
ALTER TABLE access_events ADD CONSTRAINT access_events_action_check
  CHECK (action IN ('created', 'hat_changed', 'costs_changed', 'break_changed', 'removed', 'reactivated', 'reach_changed', 'code_issued', 'books_grant_given', 'books_grant_changed', 'books_grant_revoked'));
COMMIT;
