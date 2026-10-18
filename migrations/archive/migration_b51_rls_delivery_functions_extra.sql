-- migration_b51_rls_delivery_functions_extra.sql — B1 RLS · STEP D2 (crossing pass): two more delivery-agent fns.
-- Companion to b50. Mapping routes/chits.js onto the definer layer surfaced two crossings b50 doesn't cover:
--   • dispute create/resolve write a state_log event to a SPECIFIC SUBSET of parties (not every participant) —
--     chit_log_all is "all", so we need a targeted variant.
--   • /:chit_id/priority-flag writes customer_priority (write-once, cross-edge) onto EVERY participant row.
-- Same design contract as b50: SECURITY DEFINER, owned by a BYPASSRLS role, derive the caller from
-- app.current_entity (never a spoofable arg), validate before crossing, EXECUTE to cb_app only.
--
-- ⚠️ PLATFORM-CONFIGURABILITY (Athi): as b50 — run AS the BYPASSRLS owner role (postgres on Supabase; whatever
--    admin/owner role elsewhere). Nothing here hardcodes a role or a host; the app calls by name via DATABASE_URL.
-- ⚠️ Not load-bearing until the app is cb_app + routes call these + the suite is GREEN under FORCE.
-- Rollback: DROP FUNCTION chit_log_targets(uuid,uuid[],text,uuid,text,text), chit_set_customer_priority_all(uuid,boolean);

BEGIN;

-- ── 5. chit_log_targets — write ONE audit event into a SPECIFIED SUBSET of the chit's participants ──────────
-- Used by dispute create/resolve (notify the selected parties on their own copy). Gated: caller must be a
-- participant; and it only writes to targets that are THEMSELVES participants of the chit (an entity cannot
-- inject a log row into an arbitrary tenant — the WHERE EXISTS is the isolation gate).
CREATE OR REPLACE FUNCTION chit_log_targets(
  p_chit_id    uuid,
  p_entity_ids uuid[],
  p_action     text,
  p_actor_id   uuid,
  p_actor_name text,
  p_detail     text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_caller uuid := NULLIF(current_setting('app.current_entity', true), '')::uuid;
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'chit_log_targets: no entity context (app.current_entity unset)';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM chit_status s WHERE s.chit_id = p_chit_id AND s.entity_id = v_caller) THEN
    RAISE EXCEPTION 'chit_log_targets: caller % is not a participant of %', v_caller, p_chit_id;
  END IF;
  INSERT INTO state_log
    (chit_id, entity_id, action, action_by_identity_id, action_by_display_name, detail)
  SELECT p_chit_id, t.entity_id, p_action, p_actor_id, p_actor_name, p_detail
    FROM (SELECT DISTINCT unnest(p_entity_ids) AS entity_id) t
   WHERE EXISTS (SELECT 1 FROM chit_status s WHERE s.chit_id = p_chit_id AND s.entity_id = t.entity_id);
END $$;

-- ── 6. chit_set_customer_priority_all — customer cross-edge priority (write-once) on ALL participant rows ────
-- The write-once LOCK check stays in the app (a read of the caller's OWN row via withEntity(me)); this only does
-- the cross-entity propagation. Gated: caller must be a participant.
CREATE OR REPLACE FUNCTION chit_set_customer_priority_all(p_chit_id uuid, p_flag boolean)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_caller uuid := NULLIF(current_setting('app.current_entity', true), '')::uuid;
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'chit_set_customer_priority_all: no entity context (app.current_entity unset)';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM chit_status s WHERE s.chit_id = p_chit_id AND s.entity_id = v_caller) THEN
    RAISE EXCEPTION 'chit_set_customer_priority_all: caller % is not a participant of %', v_caller, p_chit_id;
  END IF;
  UPDATE chit_status
     SET customer_priority = p_flag, customer_priority_locked = true, updated_at = NOW()
   WHERE chit_id = p_chit_id;
END $$;

-- ── Privileges: lock to the app role, not PUBLIC ───────────────────────────────────────────────────────────
REVOKE ALL ON FUNCTION chit_log_targets(uuid, uuid[], text, uuid, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION chit_set_customer_priority_all(uuid, boolean)          FROM PUBLIC;
GRANT EXECUTE ON FUNCTION chit_log_targets(uuid, uuid[], text, uuid, text, text) TO cb_app;
GRANT EXECUTE ON FUNCTION chit_set_customer_priority_all(uuid, boolean)          TO cb_app;

COMMIT;
