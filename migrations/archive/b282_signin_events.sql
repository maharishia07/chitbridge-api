-- b282_signin_events.sql — the sign-in log (IAM PR 6 / M06). Spec: C:\dev\SPEC-iam-build-2026-10-05.md §b282, decision D11.
--
-- Its own table, not access_events: b172 is the append-only record of GRANTS; 200 sign-ins a day would bury it.
-- A LOG: insert and read only, for the app. No UPDATE, no DELETE policy (b172's rule).
-- RLS: WITH. Isolated by app.current_entity — the setting db/index.js and lib/*.js SET (set_config('app.current_entity', …)).
--
-- Safe to run before M06 deploys: nothing writes here until M06 ships. If M06 ships first, its writer logs an error and
-- sign-in proceeds (spec risk 6) — never blocks.
--
-- ── RUN ORDER ─────────────────────────────────────────────────────────────────────────────────────────────────
--   STEP 1 (preview, read-only) · STEP 2 (create, one transaction) · STEP 3 (check, read-only)

-- ═════ STEP 1 · PREVIEW (read-only) ═══════════════════════════════════════════════════════════════════════════
SELECT 'signin_events exists already (0 = new)' AS what, (to_regclass('public.signin_events') IS NOT NULL)::int AS n
UNION ALL SELECT 'identities table present (must be 1)', (to_regclass('public.identities') IS NOT NULL)::int
UNION ALL SELECT 'role cb_app present (must be 1)', (SELECT count(*) FROM pg_roles WHERE rolname = 'cb_app')::int;

-- ═════ STEP 2 · CREATE (one transaction) ═══════════════════════════════════════════════════════════════════════
BEGIN;

CREATE TABLE IF NOT EXISTS signin_events (
  event_id     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_id    uuid NOT NULL,                                      -- the shop slot signed into (FK below)
  identity_id  uuid,                                               -- the membership row (null = unknown id) (FK below)
  person_id    uuid,                                               -- FK added by b283
  action       text NOT NULL CHECK (action IN ('ask','in','fail','locked','renew','out','revoke','link','unlink','device_new','device_revoke')),
  method       text CHECK (method IN ('otp','pin','passkey','google','apple','microsoft','key')),
  device_id    text,
  jti          text,
  ip           inet,
  ua           text,
  code         text,                                               -- refusal code on fail/revoke (SESSION_EXPIRED, DEVICE_REVOKED, PIN_LOCKED …)
  surface      text,                                               -- index|till|accounts|crm|standards|shop|promo|agent
  at           timestamptz NOT NULL DEFAULT now()
);
-- foreign keys added apart from CREATE TABLE IF NOT EXISTS, so a pre-existing table still gets them (migration-lint)
DO $fk$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'signin_events_entity_fkey') THEN
    ALTER TABLE signin_events ADD CONSTRAINT signin_events_entity_fkey FOREIGN KEY (entity_id) REFERENCES identities (identity_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'signin_events_identity_fkey') THEN
    ALTER TABLE signin_events ADD CONSTRAINT signin_events_identity_fkey FOREIGN KEY (identity_id) REFERENCES identities (identity_id);
  END IF;
END $fk$;
CREATE INDEX IF NOT EXISTS ix_signin_events_entity_at ON signin_events (entity_id, at DESC);

ALTER TABLE signin_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE signin_events FORCE  ROW LEVEL SECURITY;
DROP POLICY IF EXISTS signin_events_read  ON signin_events;
DROP POLICY IF EXISTS signin_events_write ON signin_events;
CREATE POLICY signin_events_read  ON signin_events FOR SELECT
  USING      (entity_id = NULLIF(current_setting('app.current_entity', true), '')::uuid);
CREATE POLICY signin_events_write ON signin_events FOR INSERT
  WITH CHECK (entity_id = NULLIF(current_setting('app.current_entity', true), '')::uuid);

GRANT  SELECT, INSERT ON signin_events TO cb_app;
REVOKE UPDATE, DELETE ON signin_events FROM cb_app;

DO $$ BEGIN RAISE NOTICE 'b282: signin_events created — insert/read only for cb_app, FORCE RLS on app.current_entity.'; END $$;
COMMIT;

-- ═════ STEP 3 · CHECK (read-only) — the RLS census line for this table ═════════════════════════════════════════
SELECT c.relname AS table_name, c.relrowsecurity AS rls_on, c.relforcerowsecurity AS forced,
       (SELECT count(*) FROM pg_policy p WHERE p.polrelid = c.oid) AS policies_must_be_2,
       (SELECT count(*) FROM information_schema.role_table_grants g
         WHERE g.table_name = 'signin_events' AND g.grantee = 'cb_app' AND g.privilege_type IN ('UPDATE','DELETE')) AS update_delete_must_be_0
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
 WHERE n.nspname = 'public' AND c.relname = 'signin_events';
