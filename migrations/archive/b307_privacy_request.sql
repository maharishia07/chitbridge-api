-- b307_privacy_request.sql — CO1 privacy (K4 + K11): the register of a person's privacy requests and grievances — what was asked,
-- when it came in, when the answer is due by law, and when and how it was answered.
--
-- ⚠️⚠️ DRAFT — NOT RUN · Athi runs it (Supabase SQL editor, AS postgres — it creates a table, a trigger, a policy and grants).
--    Nothing was run against any database for this file; it was written offline and read, not executed. Safe to re-run.
--    Until it runs, /api/crm/privacy-requests answers 503 { code: 'PRIVACY_NOT_MIGRATED' } (routes/crm.js · lib/privacy.js).
--
-- web docs/research/COMPLIANCE-OBLIGATIONS-2026-10.md K4, K11 · docs/FIELDS.md (the dictionary rows, same change).
-- Law: DPDP Act 2023 s.11–14 (Rules r.14) · SPDI Rules 2011 r.5(9) (grievance in one month — in force now) · IT Intermediary Rules 2021
--      r.3(2) (15 days, if CB is an intermediary — an open legal question) · Privacy Act 1988 APP 12, 13 · UAE PDPL Art.13–18.
--
-- ⭐ WHAT IS NEW AND WHY NOTHING EXISTING SERVED
--   · privacy_request — no request intake, clock or answer record exists (grep consent|grievance|rights in lib, routes, migrations).
--     party_followup (b276) has a due date but no "what was asked / what was answered" and can be deleted — a register cannot.
-- ⭐ ONE REGISTER FOR BOTH ROLES. A shop's customer asks the SHOP (owner_entity_id = the shop; CB is its processor). A shop owner asks
--   CB itself (CB is the fiduciary): that request lives in the PLATFORM entity's register, the same table — no second register.
-- ⭐ A REQUEST IS ANSWERED ONCE AND NEVER ERASED. DELETE is revoked from cb_app (the b282 signin_events pattern); the trigger lets an UPDATE only fill the answer of an unanswered
--   row, and never change what was asked, when, or the due date.
--
-- ⚠️ The policy reads current_setting NULLIF-guarded (tests/entity-cast-guard.test.cjs).
-- RLS: ENABLED + FORCED, one policy rls_entity (owner_entity_id = the shop the request runs as). cb_app: SELECT, INSERT, UPDATE (answer only).

CREATE TABLE IF NOT EXISTS privacy_request (
  request_id       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_entity_id  uuid NOT NULL,                 -- whose register (the shop, or the platform entity for requests to CB itself)
  party_id         uuid,                          -- the party it is about, when they are on the shop's list; NULL for anyone else
  who              text NOT NULL,                 -- the person as they gave themselves (name / phone / e-mail), ≤ 200 chars
  kind             text NOT NULL,                 -- access · correct · erase · withdraw · nominate · grievance
  country          text NOT NULL,                 -- whose law sets the clock (IN · AU · AE · …), the shop's country by default
  received_at      timestamptz NOT NULL DEFAULT now(),
  due_at           timestamptz NOT NULL,          -- received_at + the days lib/privacy.js DUE_DAYS gives for (country, kind)
  answered_at      timestamptz,
  answered_by      uuid,
  outcome          text,                          -- done · partly · refused
  answer           text,                          -- what was done, or why not, ≤ 2000 chars
  created_by       uuid,
  created_at       timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE privacy_request DROP CONSTRAINT IF EXISTS privacy_request_kind_chk;
ALTER TABLE privacy_request ADD CONSTRAINT privacy_request_kind_chk CHECK (kind IN ('access', 'correct', 'erase', 'withdraw', 'nominate', 'grievance'));
ALTER TABLE privacy_request DROP CONSTRAINT IF EXISTS privacy_request_outcome_chk;
ALTER TABLE privacy_request ADD CONSTRAINT privacy_request_outcome_chk CHECK (outcome IS NULL OR outcome IN ('done', 'partly', 'refused'));
ALTER TABLE privacy_request DROP CONSTRAINT IF EXISTS privacy_request_answer_chk;
ALTER TABLE privacy_request ADD CONSTRAINT privacy_request_answer_chk CHECK ((answered_at IS NULL) = (outcome IS NULL));
CREATE INDEX IF NOT EXISTS privacy_request_open_idx ON privacy_request (owner_entity_id, due_at) WHERE answered_at IS NULL;
CREATE INDEX IF NOT EXISTS privacy_request_party_idx ON privacy_request (owner_entity_id, party_id);
ALTER TABLE privacy_request ENABLE ROW LEVEL SECURITY;
ALTER TABLE privacy_request FORCE  ROW LEVEL SECURITY;
DROP POLICY IF EXISTS rls_entity ON privacy_request;
CREATE POLICY rls_entity ON privacy_request
  USING      (owner_entity_id = NULLIF(current_setting('app.current_entity', true), '')::uuid)
  WITH CHECK (owner_entity_id = NULLIF(current_setting('app.current_entity', true), '')::uuid);
REVOKE UPDATE, DELETE ON privacy_request FROM cb_app;
GRANT SELECT, INSERT ON privacy_request TO cb_app;
GRANT UPDATE (answered_at, answered_by, outcome, answer) ON privacy_request TO cb_app;
DO $fk$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'privacy_request_party_fkey') THEN
    ALTER TABLE privacy_request ADD CONSTRAINT privacy_request_party_fkey FOREIGN KEY (party_id) REFERENCES identities (identity_id);
  END IF;
END $fk$;

-- answered once: an answered row never changes again, and nobody (not even the owner, as postgres) rewrites what was asked
CREATE OR REPLACE FUNCTION f_privacy_request_answer_once() RETURNS trigger LANGUAGE plpgsql AS $f$
BEGIN
  IF OLD.answered_at IS NOT NULL THEN RAISE EXCEPTION 'privacy_request %: already answered — a register entry is answered once', OLD.request_id USING ERRCODE = 'P0001'; END IF;
  IF NEW.owner_entity_id IS DISTINCT FROM OLD.owner_entity_id OR NEW.party_id IS DISTINCT FROM OLD.party_id OR NEW.who IS DISTINCT FROM OLD.who
     OR NEW.kind IS DISTINCT FROM OLD.kind OR NEW.country IS DISTINCT FROM OLD.country OR NEW.received_at IS DISTINCT FROM OLD.received_at
     OR NEW.due_at IS DISTINCT FROM OLD.due_at OR NEW.created_by IS DISTINCT FROM OLD.created_by OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'privacy_request %: only the answer can be filled in', OLD.request_id USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END $f$;
DROP TRIGGER IF EXISTS privacy_request_answer_once ON privacy_request;
CREATE TRIGGER privacy_request_answer_once BEFORE UPDATE ON privacy_request FOR EACH ROW EXECUTE FUNCTION f_privacy_request_answer_once();
COMMENT ON TABLE privacy_request IS 'b307 (CO1 K4/K11) — the register of privacy requests and grievances; answered once, never deleted. Written by /api/crm/privacy-requests; read by the same.';

-- ── check (one row, after running): 1 | 1 | 1 | f | f — table, policy, trigger, cb_app may NOT delete, may NOT update `kind` ────
-- SELECT (SELECT count(*) FROM pg_tables WHERE tablename = 'privacy_request')
--      , (SELECT count(*) FROM pg_policies WHERE policyname = 'rls_entity' AND tablename = 'privacy_request')
--      , (SELECT count(*) FROM pg_trigger WHERE tgname = 'privacy_request_answer_once')
--      , has_table_privilege('cb_app', 'privacy_request', 'DELETE')
--      , has_column_privilege('cb_app', 'privacy_request', 'kind', 'UPDATE');
