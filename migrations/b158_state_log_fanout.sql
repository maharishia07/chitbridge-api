-- ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════
-- b158 — a shared event is logged to every party, not just the one who did it.
-- ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════
--
-- Found 2026-08-15 while verifying b157 end to end — which is the only reason it surfaced at all:
--
--     Karpagam recorded 5 kg against mytest's order.
--     The DELIVERY crossed (b144's definer puts it in all three copies — the API returned copies:3).
--     The NOTIFICATION did not. mytest's badge stayed at zero and the event never entered their feed.
--
-- ⭐ That is the most important event this product has. Goods moved and the other side was not told.
--
-- ── ⚠️ WHY THE FIRST FIX FAILED, WHICH IS THE INSTRUCTIVE PART ─────────────────────────────────────────────────
-- I first changed the INSERT to fan out with
--     SELECT $1, s.entity_id, … FROM (SELECT DISTINCT entity_id FROM chit_status WHERE chit_id = $1) s
-- inside withEntity(actor), and asserted in the commit that a definer "is not needed". It is needed, and the
-- test proved it within minutes: that subquery runs under RLS, so it can only SEE the actor's own chit_status
-- row — it returned exactly one entity and wrote exactly the row it had always written. The statement looked
-- like a fan-out and behaved like a single-copy insert.
--
-- This is the same reason b50/b144/b67 all use definers to reach other parties' copies. RLS is doing its job;
-- crossing the boundary has to be an explicit, audited act.
--
-- ⚠️ SO THE AUDIENCE IS COMPUTED INSIDE THE DEFINER, AND IS NOT A PARAMETER. A caller cannot ask for a row to be
-- written into an entity of their choosing — it goes to the participants of the chit they are already acting on,
-- and to nobody else. Same posture as chit_line_deliver: the gate is "are you a participant", checked here.
--
-- Safe to re-run. Adds one function; writes nothing by itself.

CREATE OR REPLACE FUNCTION state_log_fanout(
  p_chit_id uuid, p_action text, p_by_id uuid, p_by_name text, p_detail text)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_me uuid := NULLIF(current_setting('app.current_entity', true), '')::uuid;
  v_n  integer := 0;
BEGIN
  IF v_me IS NULL THEN
    RAISE EXCEPTION 'state_log_fanout: no entity context — call inside withEntity(me)';
  END IF;
  -- ⚠️ THE PARTICIPANT GATE, IDENTICAL TO chit_line_deliver's. Without it this function would let anyone write
  -- an event into any chit's parties — a notification saying something happened that did not.
  IF NOT EXISTS (SELECT 1 FROM chit_header WHERE chit_id = p_chit_id AND entity_id = v_me) THEN
    RAISE EXCEPTION 'state_log_fanout: % is not a participant of chit %', v_me, p_chit_id;
  END IF;

  /* ⚠️ DISTINCT — one row per PARTY. A self-chit holds two chit_status rows for one entity, and every other
     place today that forgot this doubled something (b150 wrote every delivery twice). */
  INSERT INTO state_log (chit_id, entity_id, action, action_by_identity_id, action_by_display_name, detail)
  SELECT p_chit_id, s.entity_id, p_action, p_by_id, p_by_name, p_detail
    FROM (SELECT DISTINCT entity_id FROM chit_status WHERE chit_id = p_chit_id) s;

  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n;
END $$;

GRANT EXECUTE ON FUNCTION state_log_fanout(uuid, text, uuid, text, text) TO cb_app;

DO $$
BEGIN
  RAISE NOTICE 'b158: state_log_fanout() added. Deliveries now notify every party, not only the one who recorded them.';
  RAISE NOTICE 'b158: the audience is computed inside the definer from the chit participants — never passed in.';
END $$;
