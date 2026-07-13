-- b102: HARDEN chit_message_deliver (reviewer M2/M3, 2026-07-13). Confidentiality-critical — the USP path.
-- The definer bypasses FORCE-RLS, so it must (a) validate its OWN inputs, and (b) NEVER fall through to the
-- all-participants loop for a dispute message. Idempotent (CREATE OR REPLACE). Athi's gate to run.
--
-- Closes:
--   M2 — fan-out FAILS OPEN: if a targeted dispute's roster can't be resolved (rows deleted/retired), b68 fell through
--        to "SELECT DISTINCT entity_id FROM chit_status" = BROADCAST to every participant, incl. non-parties. Now: RAISE.
--   M3 — the definer trusted its parameters. Now it asserts: the sender is a participant of the chit, and a dispute_id
--        BELONGS to the chit (blocks cross-chit dispute injection at the DB level, defence-in-depth behind the route fix).
--
-- Governance note (Athi to decide, not changed here): the targeted roster is still read from the LIVE per-copy
-- chit_disputes rows (scoped to THIS chit). A party who deletes/retires their copy therefore stops receiving future
-- dispute messages (opt-out) — this is UNDER-delivery, never over-delivery, so it is not a leak. If instead you want the
-- roster frozen at raise-time (deliver to the original set regardless of later deletion), switch the loop to read the
-- immutable chit_disputes.roster jsonb snapshot. Left as-is pending your decision; the fail-closed guard holds either way.

CREATE OR REPLACE FUNCTION chit_message_deliver(
  p_message_id uuid, p_chit_id uuid, p_sender_entity_id uuid, p_sender_display_name text,
  p_thread_type text, p_message_text text, p_msg_type text, p_is_dispute boolean, p_dispute_id uuid
) RETURNS timestamptz
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_created timestamptz := now(); v_ent uuid; v_scope text; v_count int := 0;
BEGIN
  -- M3a — the definer validates its own caller: the sender MUST be a participant of this chit.
  IF NOT EXISTS (SELECT 1 FROM chit_status WHERE chit_id = p_chit_id AND entity_id = p_sender_entity_id) THEN
    RAISE EXCEPTION 'chit_message_deliver: sender % is not a participant of chit % — refusing', p_sender_entity_id, p_chit_id;
  END IF;

  IF p_thread_type = 'internal' THEN   -- private to the author entity: single copy
    INSERT INTO chit_messages (message_id, entity_id, chit_id, sender_entity_id, sender_display_name,
        thread_type, visibility_entity_id, message_text, msg_type, is_dispute, dispute_id, created_at)
      VALUES (p_message_id, p_sender_entity_id, p_chit_id, p_sender_entity_id, p_sender_display_name,
        'internal', p_sender_entity_id, p_message_text, COALESCE(p_msg_type,'info'), COALESCE(p_is_dispute,false), p_dispute_id, v_created);
    RETURN v_created;
  END IF;

  IF COALESCE(p_is_dispute,false) AND p_dispute_id IS NOT NULL THEN
    -- M3b — the dispute MUST belong to THIS chit (blocks a chit-A caller passing chit-B's dispute_id).
    IF NOT EXISTS (SELECT 1 FROM chit_disputes WHERE dispute_id = p_dispute_id AND chit_id = p_chit_id) THEN
      RAISE EXCEPTION 'chit_message_deliver: dispute % does not belong to chit % — refusing', p_dispute_id, p_chit_id;
    END IF;
    SELECT scope INTO v_scope FROM chit_disputes WHERE dispute_id = p_dispute_id AND chit_id = p_chit_id LIMIT 1;
    IF COALESCE(v_scope,'targeted') <> 'chit_wide' THEN
      -- targeted → deliver ONLY to the dispute roster on this chit. FAIL CLOSED (M2): never fall through to broadcast.
      FOR v_ent IN SELECT DISTINCT entity_id FROM chit_disputes WHERE dispute_id = p_dispute_id AND chit_id = p_chit_id LOOP
        INSERT INTO chit_messages (message_id, entity_id, chit_id, sender_entity_id, sender_display_name,
            thread_type, visibility_entity_id, message_text, msg_type, is_dispute, dispute_id, created_at)
          VALUES (p_message_id, v_ent, p_chit_id, p_sender_entity_id, p_sender_display_name,
            'external', NULL, p_message_text, COALESCE(p_msg_type,'info'), true, p_dispute_id, v_created);
        v_count := v_count + 1;
      END LOOP;
      IF v_count = 0 THEN
        RAISE EXCEPTION 'chit_message_deliver: dispute % has no resolvable roster — refusing to broadcast', p_dispute_id;
      END IF;
      RETURN v_created;
    END IF;
    -- chit_wide → intentionally visible to all chit participants (known, non-confidential audience) → fall through.
  END IF;

  FOR v_ent IN SELECT DISTINCT entity_id FROM chit_status WHERE chit_id = p_chit_id LOOP   -- external / chit-wide
    INSERT INTO chit_messages (message_id, entity_id, chit_id, sender_entity_id, sender_display_name,
        thread_type, visibility_entity_id, message_text, msg_type, is_dispute, dispute_id, created_at)
      VALUES (p_message_id, v_ent, p_chit_id, p_sender_entity_id, p_sender_display_name,
        p_thread_type, NULL, p_message_text, COALESCE(p_msg_type,'info'), COALESCE(p_is_dispute,false), p_dispute_id, v_created);
  END LOOP;
  RETURN v_created;
END; $$;
GRANT EXECUTE ON FUNCTION chit_message_deliver(uuid,uuid,uuid,text,text,text,text,boolean,uuid) TO cb_app;
