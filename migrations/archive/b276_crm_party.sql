-- b276_crm_party.sql — CB CRM, Phase 4: what a party's "log it" and "remind me" need to keep, and the one column that lets the
-- shop remove a party from its list without deleting any history.
--
-- ⚠️⚠️ DRAFT — NOT RUN · Athi runs it (Supabase SQL editor, AS postgres — it creates tables, policies and grants, which cb_app cannot).
--    Nothing was run against any database for this file; it was written offline and read, not executed. Safe to re-run.
--    Until it runs, every CRM write that needs it answers 503 { code: 'CRM_NOT_MIGRATED' } and the record says `migrated: false`
--    (routes/crm.js · lib/crm-followups.js); the read side — the list, the record, the timeline's chits and ledger — needs none of it.
--
-- docs/design/crm/DATA.md §5 · PLAN.md Phase 4 · docs/FIELDS.md (the dictionary rows for these keys are in the same change).
--
-- ⭐ WHAT IS NEW AND WHY NOTHING EXISTING SERVED
--   · party_interaction — a call, a visit, a message, a note about a party. A chit needs a counterparty on the rail; chit messages are
--     per chit and two-sided. A local party has nowhere to keep "I rang him on Tuesday".
--   · party_followup — a reminder about a party, assigned to someone on the team (Q5: assignment lives here, parties have no owner).
--     The chit "due" is per chit.
--   · customer_list.hidden_at / supplier_list.hidden_at — "Remove from my parties" (Q10) hides the row; no history is deleted. Read
--     through to_jsonb everywhere, so the API runs the same before and after.
--   · ops.f_crm_followup_entities() — the one cross-shop read the nightly sweep needs: WHICH shops have an open follow-up, ids only
--     (the ops.f_books_enabled pattern, b272).
--
-- ⚠️ Foreign keys are added with ALTER TABLE, never inside CREATE TABLE IF NOT EXISTS (tests/migration-lint.test.cjs).
-- ⚠️ Every policy reads current_setting NULLIF-guarded (tests/entity-cast-guard.test.cjs) — an unset shop reads nothing, never raises.

-- ── party_interaction · a call, a visit, a message, a note ───────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS party_interaction (
  interaction_id   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_entity_id  uuid NOT NULL,
  party_id         uuid NOT NULL,                 -- the identity id of the other side (customer_list / supplier_list key)
  kind             text NOT NULL,                 -- call · visit · message · note   ('mail' joins in phase 5, with party_mail)
  direction        text,                          -- in · out · NULL (a note has none)
  body             text NOT NULL,
  at               timestamptz NOT NULL DEFAULT now(),   -- when it happened (may be earlier than created_at)
  by_user_id       uuid,                          -- who logged it (the owner or a co-assist)
  mail_id          uuid,                          -- phase 5 (party_mail); nullable now so that migration adds no column here
  created_at       timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE party_interaction DROP CONSTRAINT IF EXISTS party_interaction_kind_chk;
ALTER TABLE party_interaction ADD CONSTRAINT party_interaction_kind_chk CHECK (kind IN ('call', 'visit', 'message', 'mail', 'note'));
ALTER TABLE party_interaction DROP CONSTRAINT IF EXISTS party_interaction_dir_chk;
ALTER TABLE party_interaction ADD CONSTRAINT party_interaction_dir_chk CHECK (direction IS NULL OR direction IN ('in', 'out'));
CREATE INDEX IF NOT EXISTS party_interaction_party_idx ON party_interaction (owner_entity_id, party_id, at DESC);
ALTER TABLE party_interaction ENABLE ROW LEVEL SECURITY;
ALTER TABLE party_interaction FORCE  ROW LEVEL SECURITY;
DROP POLICY IF EXISTS rls_entity ON party_interaction;
CREATE POLICY rls_entity ON party_interaction
  USING      (owner_entity_id = NULLIF(current_setting('app.current_entity', true), '')::uuid)
  WITH CHECK (owner_entity_id = NULLIF(current_setting('app.current_entity', true), '')::uuid);
-- a log is a record: it may be added to and read, not rewritten or deleted (a wrong line is answered by a new one)
REVOKE UPDATE, DELETE ON party_interaction FROM cb_app;
GRANT SELECT, INSERT ON party_interaction TO cb_app;
DO $fk$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'party_interaction_party_fkey') THEN
    ALTER TABLE party_interaction ADD CONSTRAINT party_interaction_party_fkey FOREIGN KEY (party_id) REFERENCES identities (identity_id);
  END IF;
END $fk$;

-- ── party_followup · a reminder about a party, assigned to someone ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS party_followup (
  followup_id       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_entity_id   uuid NOT NULL,
  party_id          uuid NOT NULL,
  what              text NOT NULL,
  due_at            timestamptz NOT NULL,         -- the start of the shop's due day when typed as a date (the "late" test is in the shop's day)
  assignee_user_id  uuid,                         -- the owner or a co-assist; NULL = unassigned
  done_at           timestamptz,
  done_by           uuid,
  source            text NOT NULL DEFAULT 'manual',   -- manual · dues · interaction
  bell_day          date,                         -- the shop-day the sweep last rang the bell for it (a second run the same day rings nothing)
  created_at        timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE party_followup DROP CONSTRAINT IF EXISTS party_followup_source_chk;
ALTER TABLE party_followup ADD CONSTRAINT party_followup_source_chk CHECK (source IN ('manual', 'dues', 'interaction'));
CREATE INDEX IF NOT EXISTS party_followup_open_idx ON party_followup (owner_entity_id, due_at) WHERE done_at IS NULL;
CREATE INDEX IF NOT EXISTS party_followup_party_idx ON party_followup (owner_entity_id, party_id);
ALTER TABLE party_followup ENABLE ROW LEVEL SECURITY;
ALTER TABLE party_followup FORCE  ROW LEVEL SECURITY;
DROP POLICY IF EXISTS rls_entity ON party_followup;
CREATE POLICY rls_entity ON party_followup
  USING      (owner_entity_id = NULLIF(current_setting('app.current_entity', true), '')::uuid)
  WITH CHECK (owner_entity_id = NULLIF(current_setting('app.current_entity', true), '')::uuid);
GRANT SELECT, INSERT, UPDATE, DELETE ON party_followup TO cb_app;
DO $fk$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'party_followup_party_fkey') THEN
    ALTER TABLE party_followup ADD CONSTRAINT party_followup_party_fkey FOREIGN KEY (party_id) REFERENCES identities (identity_id);
  END IF;
END $fk$;

-- ── "Remove from my parties" (Q10): hides the row, deletes nothing ───────────────────────────────────────────────────────────
ALTER TABLE customer_list ADD COLUMN IF NOT EXISTS hidden_at timestamptz;
ALTER TABLE supplier_list ADD COLUMN IF NOT EXISTS hidden_at timestamptz;
COMMENT ON COLUMN customer_list.hidden_at IS 'b276 — set by DELETE /api/crm/parties/:id (owner, no open dues). The CRM list skips the row; every statement, chit and note stays.';
COMMENT ON COLUMN supplier_list.hidden_at IS 'b276 — as customer_list.hidden_at.';

-- ── the sweep's one cross-shop read: which shops have an open follow-up — ids only, never a row ───────────────────────────────
CREATE SCHEMA IF NOT EXISTS ops;
DROP FUNCTION IF EXISTS ops.f_crm_followup_entities();   -- a RETURNS TABLE cannot be REPLACEd with a new row type
CREATE OR REPLACE FUNCTION ops.f_crm_followup_entities()
RETURNS TABLE (owner_entity_id uuid) LANGUAGE sql SECURITY DEFINER SET search_path = public AS $f$
  SELECT DISTINCT f.owner_entity_id FROM party_followup f WHERE f.done_at IS NULL AND f.due_at < now() + interval '1 day'
$f$;
REVOKE ALL ON FUNCTION ops.f_crm_followup_entities() FROM PUBLIC;
GRANT USAGE ON SCHEMA ops TO cb_app;
GRANT EXECUTE ON FUNCTION ops.f_crm_followup_entities() TO cb_app;

-- ── check (one row, after running): 2 | 2 | 2 | 1 — both tables, both RLS policies present, both hidden_at columns, the function ──
-- SELECT (SELECT count(*) FROM pg_tables WHERE tablename IN ('party_interaction', 'party_followup'))
--      , (SELECT count(*) FROM pg_policies WHERE policyname = 'rls_entity' AND tablename IN ('party_interaction', 'party_followup'))
--      , (SELECT count(*) FROM information_schema.columns WHERE column_name = 'hidden_at' AND table_name IN ('customer_list', 'supplier_list'))
--      , (SELECT count(*) FROM pg_proc WHERE proname = 'f_crm_followup_entities');
