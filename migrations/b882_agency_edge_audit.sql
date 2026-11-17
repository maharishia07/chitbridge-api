-- b882_agency_edge_audit.sql — FIRM-PARENT-DOOR (18 Nov 2026, design PM/firm-staff/FIRM-PARENT-DOOR-DESIGN-2026-11-18.md 3.5): the ask, approval, decline and end of a firm's agency edge become access_events rows.
--
-- ⚠️ NOT RUN anywhere · Athi runs it (Supabase SQL editor, AS postgres), SIT first through the box's migrate step. Safe to repeat (DROP ... IF EXISTS first). Touches no row.
--    The api is correct BEFORE and AFTER this file runs: until it runs, lib/edge-audit.js writes nothing (access-events.record swallows the refused value, logs it and counts it in audit_lost); ask, approve, decline and disconnect all still succeed.
-- NUMBER. b881 is the highest reserved on the integration batch; this is the next → b882. Rename before landing if another round took it.
-- LOOKED AT (DISCIPLINES 4a): access_events (the one table widened; its newest check is b866's, copied here whole so no value allowed before is lost); cb_edge (READ ONLY, nothing changes).
-- WHAT IT DOES. access_events_action_check gains four values: agency_asked, agency_approved, agency_declined, agency_ended. Every value b866 allowed stays allowed.
--    entity_id = the client (the business whose books the firm would reach), subject_identity_id = the firm, changed_by = the person who acted, before/after = the edge's state.
-- OWNER: lib/edge-audit.js (writes) · src/routes/network.js (the four routes call it).
-- ROLL BACK (first DELETE FROM access_events WHERE action LIKE 'agency\_%'; as postgres, because the old check refuses them):
--    ALTER TABLE access_events DROP CONSTRAINT IF EXISTS access_events_action_check;
--    ALTER TABLE access_events ADD CONSTRAINT access_events_action_check CHECK (action IN ('created', 'hat_changed', 'costs_changed', 'break_changed', 'removed', 'reactivated', 'reach_changed', 'code_issued', 'books_grant_given', 'books_grant_changed', 'books_grant_revoked', 'books_delegated_first', 'books_delegated_unlock', 'books_delegated_year_close'));
-- CHECK (read-only, every row must read ok = true):
--    SELECT 'action allows the four agency steps and keeps b866' AS what, (SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conname = 'access_events_action_check') ~ 'agency_asked.*agency_approved.*agency_declined.*agency_ended'
--      AND (SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conname = 'access_events_action_check') LIKE '%books_delegated_year_close%' AS ok
--    UNION ALL SELECT 'access_events still FORCE RLS', (SELECT relforcerowsecurity FROM pg_class WHERE oid = 'public.access_events'::regclass);
-- RLS: no table is new and no policy changes: access_events keeps ENABLE + FORCE row security and its entity_id isolation policy (the writer binds the CLIENT as the entity); cb_app's privileges are untouched (a CHECK is not a privilege).

BEGIN;
SET LOCAL lock_timeout = '5s';

ALTER TABLE access_events DROP CONSTRAINT IF EXISTS access_events_action_check;
ALTER TABLE access_events ADD CONSTRAINT access_events_action_check
  CHECK (action IN ('created', 'hat_changed', 'costs_changed', 'break_changed', 'removed', 'reactivated', 'reach_changed', 'code_issued', 'books_grant_given', 'books_grant_changed', 'books_grant_revoked', 'books_delegated_first', 'books_delegated_unlock', 'books_delegated_year_close', 'agency_asked', 'agency_approved', 'agency_declined', 'agency_ended'));
COMMIT;
