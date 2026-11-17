-- migration_b52_rls_parity_read.sql — B1 RLS · STEP D2 (crossing pass): the dispute parity cross-read.
-- Companion to b50/b51. Raising a dispute probes whether the COUNTERPARTY still holds a live copy of the chit
-- (present / archived / absent) to decide two-sided vs one-sided (record-only). That is a cross-entity read of
-- the target's chit_status row, which strict RLS hides from the caller. This SECURITY DEFINER fn serves exactly
-- that one fact, gated so the caller must be a participant of the chit.
--
-- Same contract as b50/b51: derive the caller from app.current_entity (not spoofable), validate, EXECUTE to
-- cb_app only, owned by a BYPASSRLS role (postgres on Supabase; whatever admin/owner role elsewhere — config,
-- not a constant). Not load-bearing until cb_app + routes call it + the suite is GREEN under FORCE.
-- Rollback: DROP FUNCTION chit_participant_parity(uuid, uuid);

BEGIN;

-- Returns ONE row iff the target holds a copy of the chit (with its deleted_at, so the caller can tell
-- present vs archived); returns NO rows when the target has no copy (absent). Mirrors the old direct read
-- `SELECT deleted_at FROM chit_status WHERE chit_id=$1 AND entity_id=$2` — same row-presence semantics.
CREATE OR REPLACE FUNCTION chit_participant_parity(p_chit_id uuid, p_target uuid)
RETURNS TABLE (present boolean, deleted_at timestamp)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_caller uuid := NULLIF(current_setting('app.current_entity', true), '')::uuid;
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'chit_participant_parity: no entity context (app.current_entity unset)';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM chit_status s WHERE s.chit_id = p_chit_id AND s.entity_id = v_caller) THEN
    RAISE EXCEPTION 'chit_participant_parity: caller % is not a participant of %', v_caller, p_chit_id;
  END IF;
  RETURN QUERY
    SELECT true, cs.deleted_at
      FROM chit_status cs
     WHERE cs.chit_id = p_chit_id AND cs.entity_id = p_target;
END $$;

REVOKE ALL   ON FUNCTION chit_participant_parity(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION chit_participant_parity(uuid, uuid) TO cb_app;

COMMIT;
