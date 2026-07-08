-- b68: DISPUTES become PER-ENTITY copies (Option A — nothing shared, no coupling). Each participant owns its own
-- chit_disputes row (its status/resolution + an embedded roster snapshot). dispute_participants is RETIRED — its job
-- (roster + per-party status) folds into the per-copy rows. So an entity can delete its dispute copy at its own will
-- (or by constitution/retention) with zero effect on the others, and there is no shared row or CASCADE coupling to orphan.
--
-- Existing dispute rows are DELETED (Athi: test data, disposable) so the NOT NULL entity_id + composite PK apply cleanly.
-- Reads/guards move to withEntity in the b68 code pass; writes go through the definer fns below (bypass FORCE-RLS as owner).

-- 0. clear disposable dispute test data (dispute messages are per-copy already via b67)
DELETE FROM chit_messages WHERE is_dispute = true;
DELETE FROM dispute_participants;
DELETE FROM chit_disputes;

-- 1. per-copy shape
ALTER TABLE chit_disputes ADD COLUMN IF NOT EXISTS entity_id uuid NOT NULL;
ALTER TABLE chit_disputes ADD COLUMN IF NOT EXISTS role      text NOT NULL DEFAULT 'party';   -- this copy's owner role: raiser | party
ALTER TABLE chit_disputes ADD COLUMN IF NOT EXISTS roster    jsonb NOT NULL DEFAULT '[]'::jsonb; -- snapshot [{entity_id,display_name,role}]

ALTER TABLE chit_disputes DROP CONSTRAINT IF EXISTS chit_disputes_pkey;
ALTER TABLE chit_disputes ADD CONSTRAINT chit_disputes_pkey PRIMARY KEY (dispute_id, entity_id);
CREATE INDEX IF NOT EXISTS chit_disputes_entity_chit_idx ON chit_disputes(entity_id, chit_id);

-- 2. cut the coupling: dispute_participants is retired; drop its FK to chit_disputes so nothing cascades cross-entity
ALTER TABLE dispute_participants DROP CONSTRAINT IF EXISTS dispute_participants_dispute_id_fkey;

-- 3. RLS — each entity sees ONLY its own dispute copies
ALTER TABLE chit_disputes ENABLE ROW LEVEL SECURITY;
ALTER TABLE chit_disputes FORCE  ROW LEVEL SECURITY;
DROP POLICY IF EXISTS rls_entity ON chit_disputes;
CREATE POLICY rls_entity ON chit_disputes
  USING      (entity_id = NULLIF(current_setting('app.current_entity', true), '')::uuid)
  WITH CHECK (entity_id = NULLIF(current_setting('app.current_entity', true), '')::uuid);

-- 4a. deliver: replicate the dispute header to every participant (raiser + parties). Runs as owner → bypasses RLS.
CREATE OR REPLACE FUNCTION chit_dispute_deliver(
  p_dispute_id uuid, p_chit_id uuid, p_raised_by uuid, p_raised_by_name text, p_target uuid, p_target_name text,
  p_scope text, p_mode text, p_answerable boolean, p_parity_state text, p_via text, p_category text, p_reason text,
  p_evidence jsonb, p_roster jsonb, p_audience uuid[]
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_ent uuid;
BEGIN
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

-- 4b. resolve: raiser clears one party (or all); the dispute closes for everyone only when no party copy is still open.
CREATE OR REPLACE FUNCTION chit_dispute_resolve(
  p_dispute_id uuid, p_resolver uuid, p_target_party uuid, p_resolution_note text
) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_remaining int;
BEGIN
  IF p_target_party IS NOT NULL THEN
    UPDATE chit_disputes SET status='resolved', resolution_note=p_resolution_note, resolved_by_entity_id=p_resolver, resolved_at=now()
      WHERE dispute_id=p_dispute_id AND entity_id=p_target_party AND role='party';
  ELSE
    UPDATE chit_disputes SET status='resolved', resolution_note=p_resolution_note, resolved_by_entity_id=p_resolver, resolved_at=now()
      WHERE dispute_id=p_dispute_id AND role='party';
  END IF;
  SELECT COUNT(*) INTO v_remaining FROM chit_disputes WHERE dispute_id=p_dispute_id AND role='party' AND status='open';
  IF v_remaining = 0 THEN   -- close the raiser's copy too
    UPDATE chit_disputes SET status='resolved', resolution_note=p_resolution_note, resolved_by_entity_id=p_resolver, resolved_at=now()
      WHERE dispute_id=p_dispute_id AND role='raiser';
    RETURN true;
  END IF;
  RETURN false;
END; $$;

-- 4c. roster: read every party's (entity_id, role, status) for a dispute — for display of who-resolved-what.
CREATE OR REPLACE FUNCTION chit_dispute_roster(p_dispute_id uuid)
RETURNS TABLE(entity_id uuid, role text, status text, resolved_at timestamptz)
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  SELECT entity_id, role, status, resolved_at FROM chit_disputes WHERE dispute_id = p_dispute_id;
$$;

GRANT EXECUTE ON FUNCTION chit_dispute_deliver(uuid,uuid,uuid,text,uuid,text,text,text,boolean,text,text,text,text,jsonb,jsonb,uuid[]) TO cb_app;
GRANT EXECUTE ON FUNCTION chit_dispute_resolve(uuid,uuid,uuid,text) TO cb_app;
GRANT EXECUTE ON FUNCTION chit_dispute_roster(uuid) TO cb_app;
