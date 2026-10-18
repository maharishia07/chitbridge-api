-- b103: bring the b67/b68 definers back to the b50 STANDARD (reviewer root-pattern sweep, 2026-07-13).
-- ROOT PRINCIPLE: identity + authority come from the server's TRUSTED context (app.current_entity), NEVER from a
-- parameter. Each definer now reads v_caller := current_setting('app.current_entity'), FAILS CLOSED if absent, and
-- VERIFIES the claimed p_sender/p_raised_by/p_resolver equals v_caller. Closes M1, M2, M3 and NEW-1 at the root.
-- Idempotent (CREATE OR REPLACE). SUPERSEDES b102's chit_message_deliver (safe to run either/both). Athi's gate.
--
-- PRE-REQ (already deployed in code): postMessageCopies now calls chit_message_deliver INSIDE withEntity(sender), and
-- chit_dispute_deliver / chit_dispute_resolve are already called inside withEntity — so the context is present. Deploy
-- the code first (done), then run this; old definers ignore context, new ones require it — order-safe.

-- ── chit_message_deliver — M1/M2/M3 at the root ────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION chit_message_deliver(
  p_message_id uuid, p_chit_id uuid, p_sender_entity_id uuid, p_sender_display_name text,
  p_thread_type text, p_message_text text, p_msg_type text, p_is_dispute boolean, p_dispute_id uuid
) RETURNS timestamptz
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_created timestamptz := now(); v_caller uuid; v_ent uuid; v_scope text; v_count int := 0;
BEGIN
  v_caller := NULLIF(current_setting('app.current_entity', true), '')::uuid;
  IF v_caller IS NULL THEN RAISE EXCEPTION 'chit_message_deliver: no entity context — call inside withEntity(sender)'; END IF;
  IF p_sender_entity_id IS DISTINCT FROM v_caller THEN
    RAISE EXCEPTION 'chit_message_deliver: claimed sender % <> caller %', p_sender_entity_id, v_caller; END IF;
  IF NOT EXISTS (SELECT 1 FROM chit_status WHERE chit_id = p_chit_id AND entity_id = v_caller) THEN
    RAISE EXCEPTION 'chit_message_deliver: sender % is not a participant of chit %', v_caller, p_chit_id; END IF;

  IF p_thread_type = 'internal' THEN   -- private to the author entity: single copy
    INSERT INTO chit_messages (message_id, entity_id, chit_id, sender_entity_id, sender_display_name,
        thread_type, visibility_entity_id, message_text, msg_type, is_dispute, dispute_id, created_at)
      VALUES (p_message_id, v_caller, p_chit_id, v_caller, p_sender_display_name,
        'internal', v_caller, p_message_text, COALESCE(p_msg_type,'info'), COALESCE(p_is_dispute,false), p_dispute_id, v_created);
    RETURN v_created;
  END IF;

  IF COALESCE(p_is_dispute,false) AND p_dispute_id IS NOT NULL THEN
    -- M3b: the dispute must belong to THIS chit; M1: the caller must be a PARTY to it (owns a copy on this chit).
    IF NOT EXISTS (SELECT 1 FROM chit_disputes WHERE dispute_id = p_dispute_id AND chit_id = p_chit_id) THEN
      RAISE EXCEPTION 'chit_message_deliver: dispute % does not belong to chit %', p_dispute_id, p_chit_id; END IF;
    IF NOT EXISTS (SELECT 1 FROM chit_disputes WHERE dispute_id = p_dispute_id AND chit_id = p_chit_id AND entity_id = v_caller) THEN
      RAISE EXCEPTION 'chit_message_deliver: sender % is not a party to dispute %', v_caller, p_dispute_id; END IF;
    SELECT scope INTO v_scope FROM chit_disputes WHERE dispute_id = p_dispute_id AND chit_id = p_chit_id LIMIT 1;
    IF COALESCE(v_scope,'targeted') <> 'chit_wide' THEN
      FOR v_ent IN SELECT DISTINCT entity_id FROM chit_disputes WHERE dispute_id = p_dispute_id AND chit_id = p_chit_id LOOP
        INSERT INTO chit_messages (message_id, entity_id, chit_id, sender_entity_id, sender_display_name,
            thread_type, visibility_entity_id, message_text, msg_type, is_dispute, dispute_id, created_at)
          VALUES (p_message_id, v_ent, p_chit_id, v_caller, p_sender_display_name,
            'external', NULL, p_message_text, COALESCE(p_msg_type,'info'), true, p_dispute_id, v_created);
        v_count := v_count + 1;
      END LOOP;
      IF v_count = 0 THEN   -- M2: NEVER fall through to broadcast when a dispute roster can't be resolved
        RAISE EXCEPTION 'chit_message_deliver: dispute % has no resolvable roster — refusing to broadcast', p_dispute_id; END IF;
      RETURN v_created;
    END IF;
  END IF;

  FOR v_ent IN SELECT DISTINCT entity_id FROM chit_status WHERE chit_id = p_chit_id LOOP   -- external / chit-wide
    INSERT INTO chit_messages (message_id, entity_id, chit_id, sender_entity_id, sender_display_name,
        thread_type, visibility_entity_id, message_text, msg_type, is_dispute, dispute_id, created_at)
      VALUES (p_message_id, v_ent, p_chit_id, v_caller, p_sender_display_name,
        p_thread_type, NULL, p_message_text, COALESCE(p_msg_type,'info'), COALESCE(p_is_dispute,false), p_dispute_id, v_created);
  END LOOP;
  RETURN v_created;
END; $$;
GRANT EXECUTE ON FUNCTION chit_message_deliver(uuid,uuid,uuid,text,text,text,text,boolean,uuid) TO cb_app;

-- ── chit_dispute_deliver — the raiser is the caller ────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION chit_dispute_deliver(
  p_dispute_id uuid, p_chit_id uuid, p_raised_by uuid, p_raised_by_name text, p_target uuid, p_target_name text,
  p_scope text, p_mode text, p_answerable boolean, p_parity_state text, p_via text, p_category text, p_reason text,
  p_evidence jsonb, p_roster jsonb, p_audience uuid[]
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_caller uuid; v_ent uuid;
BEGIN
  v_caller := NULLIF(current_setting('app.current_entity', true), '')::uuid;
  IF v_caller IS NULL THEN RAISE EXCEPTION 'chit_dispute_deliver: no entity context — call inside withEntity(raiser)'; END IF;
  IF p_raised_by IS DISTINCT FROM v_caller THEN
    RAISE EXCEPTION 'chit_dispute_deliver: claimed raiser % <> caller %', p_raised_by, v_caller; END IF;
  IF NOT EXISTS (SELECT 1 FROM chit_status WHERE chit_id = p_chit_id AND entity_id = v_caller) THEN
    RAISE EXCEPTION 'chit_dispute_deliver: raiser % is not a participant of chit %', v_caller, p_chit_id; END IF;
  FOREACH v_ent IN ARRAY p_audience LOOP
    INSERT INTO chit_disputes (dispute_id, entity_id, role, roster, chit_id, raised_by_entity_id, raised_by_display_name,
        target_entity_id, target_display_name, scope, mode, answerable, parity_state, via, category, reason,
        evidence_snapshot, status, created_at)
      VALUES (p_dispute_id, v_ent, CASE WHEN v_ent = p_raised_by THEN 'raiser' ELSE 'party' END, p_roster,
        p_chit_id, p_raised_by, p_raised_by_name, p_target, p_target_name, p_scope, p_mode, p_answerable,
        p_parity_state, p_via, p_category, p_reason, p_evidence, 'open', now())
      ON CONFLICT (dispute_id, entity_id) DO NOTHING;
  END LOOP;
END; $$;
GRANT EXECUTE ON FUNCTION chit_dispute_deliver(uuid,uuid,uuid,text,uuid,text,text,text,boolean,text,text,text,text,jsonb,jsonb,uuid[]) TO cb_app;

-- ── chit_dispute_resolve — NEW-1: ONLY the raiser (the caller) can resolve ─────────────────────────────────────
CREATE OR REPLACE FUNCTION chit_dispute_resolve(
  p_dispute_id uuid, p_resolver uuid, p_target_party uuid, p_resolution_note text
) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_caller uuid; v_remaining int;
BEGIN
  v_caller := NULLIF(current_setting('app.current_entity', true), '')::uuid;
  IF v_caller IS NULL THEN RAISE EXCEPTION 'chit_dispute_resolve: no entity context — call inside withEntity(resolver)'; END IF;
  IF p_resolver IS DISTINCT FROM v_caller THEN
    RAISE EXCEPTION 'chit_dispute_resolve: claimed resolver % <> caller %', p_resolver, v_caller; END IF;
  -- NEW-1: the caller must OWN the RAISER copy of this dispute. FR-D1 (only the raiser resolves) now has a DB backstop.
  IF NOT EXISTS (SELECT 1 FROM chit_disputes WHERE dispute_id = p_dispute_id AND entity_id = v_caller AND role = 'raiser') THEN
    RAISE EXCEPTION 'chit_dispute_resolve: % is not the raiser of dispute % — only the raiser can resolve', v_caller, p_dispute_id; END IF;
  IF p_target_party IS NOT NULL THEN
    UPDATE chit_disputes SET status='resolved', resolution_note=p_resolution_note, resolved_by_entity_id=v_caller, resolved_at=now()
      WHERE dispute_id=p_dispute_id AND entity_id=p_target_party AND role='party';
  ELSE
    UPDATE chit_disputes SET status='resolved', resolution_note=p_resolution_note, resolved_by_entity_id=v_caller, resolved_at=now()
      WHERE dispute_id=p_dispute_id AND role='party';
  END IF;
  SELECT COUNT(*) INTO v_remaining FROM chit_disputes WHERE dispute_id=p_dispute_id AND role='party' AND status='open';
  IF v_remaining = 0 THEN
    UPDATE chit_disputes SET status='resolved', resolution_note=p_resolution_note, resolved_by_entity_id=v_caller, resolved_at=now()
      WHERE dispute_id=p_dispute_id AND role='raiser';
    RETURN true;
  END IF;
  RETURN false;
END; $$;
GRANT EXECUTE ON FUNCTION chit_dispute_resolve(uuid,uuid,uuid,text) TO cb_app;
