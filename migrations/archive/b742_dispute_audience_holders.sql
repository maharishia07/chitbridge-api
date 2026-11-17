-- b742 (SEC-FIX3 S4): chit_dispute_deliver copies a dispute only to audience members that HOLD the chit.
-- Before: the definer checked the raiser only, so a shop could name any entity and plant "Dispute raised against you" in its queue.
-- The route (routes/chits.js holdersAmong) already filters; this is the same rule at the definer, the last door.
-- Idempotent (CREATE OR REPLACE; same signature and grant as b103). RLS: no new table. Rollback: re-run the chit_dispute_deliver
-- body from b103_definers_b50_standard.sql. The owner runs it; code works without it.
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
    CONTINUE WHEN v_ent IS DISTINCT FROM v_caller
      AND NOT EXISTS (SELECT 1 FROM chit_status WHERE chit_id = p_chit_id AND entity_id = v_ent);   -- not a holder: no copy
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
