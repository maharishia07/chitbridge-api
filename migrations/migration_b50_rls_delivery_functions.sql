-- migration_b50_rls_delivery_functions.sql — B1 RLS · STEP D2: the SECURITY DEFINER "delivery agent" layer.
-- A chit is a shared record materialised as N per-entity copies. A few operations legitimately CROSS the entity
-- boundary — delivering recipient copies, reading the participants panel, logging one event to every participant,
-- propagating a cancel/void. Under strict per-entity RLS (withEntity(me) + FORCE) these fail closed. Rather than
-- hand the app a wide bypass, we localise every crossing into these FOUR audited functions (the "delivery agent",
-- like an SMTP server writing to recipients' mailboxes). Everything else stays strict withEntity(me).
--
-- Each function DERIVES the caller from `current_setting('app.current_entity')` (never a spoofable arg) and
-- VALIDATES it (sender-only / participant-only) before crossing. So although the functions bypass RLS, a tenant
-- can only act on chits it legitimately sends / participates in. This is the ONE controlled bypass surface.
--
-- ============================================================================================================
-- ⚠️ PLATFORM-CONFIGURABILITY (Athi): nothing environment-specific is hardcoded here.
--   • OWNERSHIP: SECURITY DEFINER runs as the function OWNER; to cross under FORCE the owner must be a BYPASSRLS
--     role. Run this migration AS that role (on Supabase = `postgres`, which keeps BYPASSRLS). On another Postgres
--     it's whatever admin/owner role you migrate as — a role property, not a code constant. Do NOT hardcode a role
--     name in app code; the app only ever calls the functions by name via `DATABASE_URL` (as cb_app).
--   • SEARCH_PATH is pinned (`public, pg_temp`) per SECURITY DEFINER best practice — not env-specific.
--   • The functions read the SAME `app.current_entity` GUC the app already sets via withEntity(); no new config.
-- ============================================================================================================
--
-- ⚠️ NOT ENFORCED / not load-bearing until: (a) the app connects as cb_app (else RLS is a no-op and these are just
--    ordinary writes), and (b) the routes are migrated to CALL these (Step D2b), and (c) the isolation suite is
--    GREEN under FORCE. `node --check` / "it created cleanly" is NOT the done-signal.
--
-- Rollback: DROP FUNCTION chit_deliver(uuid,boolean,jsonb), chit_participants(uuid),
--           chit_log_all(uuid,text,uuid,text,text,text,text), chit_set_status_all(uuid,text);

BEGIN;

-- ── 1. chit_deliver — the send fan-out (write sender + all receiver copies atomically) ─────────────────────
-- p_copies = jsonb array, one element per participant copy. The app composes these exactly as /send does today
-- (all business logic stays in JS — this function only WRITES, so it never drifts from the app's rules). Every
-- copy must carry the SAME sender = the caller; that is the isolation gate (you can only deliver what you send).
--   copy = { entity_id, direction, role, current_status, priority_flag?, payload_delivered?('true'|_),
--            sender_entity_id, sender_entity_bridge_id, sender_entity_display_name,
--            all_recipients(jsonb), purpose, auto_subject, manual_subject, summary_json(jsonb),
--            business_json(jsonb), schema_version, schema_id, created_by_actor_id,
--            detail_type, line_item_count, total_value, currency_code, line_items(jsonb),
--            log?: { action, action_by_identity_id, action_by_display_name, new_status, detail } }
-- p_clear_first = true when promoting a draft in place: clears the caller's OWN prior rows for this chit first.
CREATE OR REPLACE FUNCTION chit_deliver(p_chit_id uuid, p_clear_first boolean, p_copies jsonb)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_sender uuid := NULLIF(current_setting('app.current_entity', true), '')::uuid;
  c jsonb;
BEGIN
  IF v_sender IS NULL THEN
    RAISE EXCEPTION 'chit_deliver: no entity context (app.current_entity unset) — call inside withEntity(sender)';
  END IF;

  -- Isolation gate: a tenant may only deliver chits it is the sender of.
  FOR c IN SELECT value FROM jsonb_array_elements(p_copies) AS value LOOP
    IF (c->>'sender_entity_id')::uuid IS DISTINCT FROM v_sender THEN
      RAISE EXCEPTION 'chit_deliver: copy sender % <> caller % (a tenant can only deliver chits it sends)',
        c->>'sender_entity_id', v_sender;
    END IF;
  END LOOP;

  IF p_clear_first THEN   -- draft promotion: re-insert cleanly under the SAME chit_id (caller's own rows only)
    DELETE FROM state_log   WHERE chit_id = p_chit_id AND entity_id = v_sender;
    DELETE FROM chit_detail WHERE chit_id = p_chit_id AND entity_id = v_sender;
    DELETE FROM chit_status WHERE chit_id = p_chit_id AND entity_id = v_sender;
    DELETE FROM chit_header WHERE chit_id = p_chit_id AND entity_id = v_sender;
  END IF;

  FOR c IN SELECT value FROM jsonb_array_elements(p_copies) AS value LOOP
    INSERT INTO chit_header
      (chit_id, entity_id, sender_entity_id, sender_entity_bridge_id, sender_entity_display_name,
       all_recipients, purpose, auto_subject, manual_subject, summary_json, business_json,
       schema_version, schema_id, created_by_actor_id, role, chit_ref, direction, sent_at, created_at)
    VALUES
      (p_chit_id, (c->>'entity_id')::uuid, v_sender, c->>'sender_entity_bridge_id', c->>'sender_entity_display_name',
       COALESCE(c->'all_recipients', '[]'::jsonb), c->>'purpose', c->>'auto_subject', c->>'manual_subject',
       c->'summary_json', c->'business_json',
       c->>'schema_version', (c->>'schema_id')::uuid, (c->>'created_by_actor_id')::uuid,
       c->>'role', p_chit_id, c->>'direction', NOW(), NOW());

    INSERT INTO chit_detail
      (chit_id, entity_id, detail_type, line_item_count, total_value, currency_code, line_items,
       direction, payload_delivered_at)
    VALUES
      (p_chit_id, (c->>'entity_id')::uuid, c->>'detail_type', COALESCE((c->>'line_item_count')::int, 0),
       COALESCE((c->>'total_value')::numeric, 0), COALESCE(c->>'currency_code', 'INR'), c->'line_items',
       c->>'direction', CASE WHEN (c->>'payload_delivered') = 'true' THEN NOW() ELSE NULL END);

    INSERT INTO chit_status (chit_id, entity_id, current_status, direction, priority_flag)
    VALUES
      (p_chit_id, (c->>'entity_id')::uuid, c->>'current_status', c->>'direction',
       COALESCE(c->>'priority_flag', 'normal'));

    IF c ? 'log' AND c->'log' IS NOT NULL THEN
      INSERT INTO state_log
        (chit_id, entity_id, action, action_by_identity_id, action_by_display_name, new_status, detail)
      VALUES
        (p_chit_id, (c->>'entity_id')::uuid, c->'log'->>'action', (c->'log'->>'action_by_identity_id')::uuid,
         c->'log'->>'action_by_display_name', c->'log'->>'new_status', c->'log'->>'detail');
    END IF;
  END LOOP;
END $$;

-- ── 2. chit_participants — the cross-entity READ for the detail page's "who has read / accepted" panel ──────
-- Mirrors the current allStatuses query. Gated: the caller must be a participant of the chit.
CREATE OR REPLACE FUNCTION chit_participants(p_chit_id uuid)
RETURNS TABLE (
  entity_id                      uuid,
  current_status                 varchar,
  read_at                        timestamp,
  assigned_to_actor_display_name varchar,
  updated_at                     timestamp,
  display_name                   varchar,
  bridge_id                      varchar
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_caller uuid := NULLIF(current_setting('app.current_entity', true), '')::uuid;
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'chit_participants: no entity context (app.current_entity unset)';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM chit_status s WHERE s.chit_id = p_chit_id AND s.entity_id = v_caller) THEN
    RAISE EXCEPTION 'chit_participants: caller % is not a participant of %', v_caller, p_chit_id;
  END IF;
  RETURN QUERY
    SELECT cs.entity_id, cs.current_status, cs.read_at, cs.assigned_to_actor_display_name, cs.updated_at,
           i.display_name, i.bridge_id
      FROM chit_status cs
      JOIN identities i ON i.identity_id = cs.entity_id
     WHERE cs.chit_id = p_chit_id;
END $$;

-- ── 3. chit_log_all — write ONE audit event into EVERY participant's copy (shared-record timeline) ──────────
-- Replaces the recurring `INSERT INTO state_log ... SELECT DISTINCT entity_id FROM chit_status WHERE chit_id=$1`
-- (status change, message post, void, etc.). Gated: caller must be a participant.
CREATE OR REPLACE FUNCTION chit_log_all(
  p_chit_id     uuid,
  p_action      text,
  p_actor_id    uuid,
  p_actor_name  text,
  p_prev_status text,
  p_new_status  text,
  p_detail      text
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
    RAISE EXCEPTION 'chit_log_all: no entity context (app.current_entity unset)';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM chit_status s WHERE s.chit_id = p_chit_id AND s.entity_id = v_caller) THEN
    RAISE EXCEPTION 'chit_log_all: caller % is not a participant of %', v_caller, p_chit_id;
  END IF;
  INSERT INTO state_log
    (chit_id, entity_id, action, action_by_identity_id, action_by_display_name, previous_status, new_status, detail)
  SELECT p_chit_id, cs.entity_id, p_action, p_actor_id, p_actor_name, p_prev_status, p_new_status, p_detail
    FROM (SELECT DISTINCT entity_id FROM chit_status WHERE chit_id = p_chit_id) cs;
END $$;

-- ── 4. chit_set_status_all — propagate a status to ALL participants (sender cancel / void) ──────────────────
-- Gated: caller must be the SENDER of the chit (only the sender can cancel/void for everyone).
CREATE OR REPLACE FUNCTION chit_set_status_all(p_chit_id uuid, p_new_status text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_caller uuid := NULLIF(current_setting('app.current_entity', true), '')::uuid;
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'chit_set_status_all: no entity context (app.current_entity unset)';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM chit_header h
     WHERE h.chit_id = p_chit_id AND h.entity_id = v_caller AND h.sender_entity_id = v_caller
  ) THEN
    RAISE EXCEPTION 'chit_set_status_all: caller % is not the sender of %', v_caller, p_chit_id;
  END IF;
  UPDATE chit_status SET current_status = p_new_status, updated_at = NOW() WHERE chit_id = p_chit_id;
END $$;

-- ── Privileges: these are the ONLY cross-entity path — lock them to the app role, not PUBLIC ────────────────
REVOKE ALL ON FUNCTION chit_deliver(uuid, boolean, jsonb)                       FROM PUBLIC;
REVOKE ALL ON FUNCTION chit_participants(uuid)                                  FROM PUBLIC;
REVOKE ALL ON FUNCTION chit_log_all(uuid, text, uuid, text, text, text, text)   FROM PUBLIC;
REVOKE ALL ON FUNCTION chit_set_status_all(uuid, text)                          FROM PUBLIC;
GRANT EXECUTE ON FUNCTION chit_deliver(uuid, boolean, jsonb)                     TO cb_app;
GRANT EXECUTE ON FUNCTION chit_participants(uuid)                                TO cb_app;
GRANT EXECUTE ON FUNCTION chit_log_all(uuid, text, uuid, text, text, text, text) TO cb_app;
GRANT EXECUTE ON FUNCTION chit_set_status_all(uuid, text)                        TO cb_app;

COMMIT;

-- Verify (as postgres): the functions are SECURITY DEFINER and owned by a BYPASSRLS role.
--   SELECT p.proname, p.prosecdef, r.rolname, r.rolbypassrls
--     FROM pg_proc p JOIN pg_roles r ON r.oid = p.proowner
--    WHERE p.proname IN ('chit_deliver','chit_participants','chit_log_all','chit_set_status_all');
--   -- expect prosecdef=true and rolbypassrls=true for each (else they cannot cross under FORCE).
