-- ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════
-- b730 — a retried goods-in / despatch / online-order delivery lands ONCE (PAY-FIX H6, Claude review 15 Oct).
-- ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════
-- The counter queues delivery rows with no replay key; a timeout AFTER the server committed made the retry insert the same
-- quantity again, doubling received stock, order progress and goods-in acceptance. FIX: an optional `client_ref` per row
-- (the press / queue row's own key), a PARTIAL unique index on (entity, chit, line, client_ref), and chit_line_event takes it as
-- a 12th argument and writes `ON CONFLICT DO NOTHING` — a replay inserts 0 rows and the caller answers "already recorded".
-- The key is NOT (reference, kind): "6 then 4" under one GRN reference is a normal, legitimate pair of rows.
--
-- RLS: unchanged — chit_line_delivery keeps its own policies; this adds a nullable column and an index only.
-- Old callers (no client_ref) keep today's behaviour: the 11-argument chit_line_event stays, delegating (NULL key).
-- Safe to run twice. Roll back: DROP INDEX ux_chit_line_delivery_client_ref; the column and the 12-argument function may stay.

ALTER TABLE chit_line_delivery ADD COLUMN IF NOT EXISTS client_ref text;

CREATE UNIQUE INDEX IF NOT EXISTS ux_chit_line_delivery_client_ref
  ON chit_line_delivery (entity_id, chit_id, line_id, client_ref)
  WHERE client_ref IS NOT NULL;

CREATE OR REPLACE FUNCTION chit_line_event(
  p_chit_id uuid, p_line_id uuid, p_qty numeric, p_unit text,
  p_reference text, p_note text, p_actor_id uuid, p_actor_name text,
  p_kind text, p_amount numeric, p_particulars text, p_client_ref text)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_me   uuid := NULLIF(current_setting('app.current_entity', true), '')::uuid;
  v_name text;
  v_kind text := COALESCE(NULLIF(btrim(lower(p_kind)), ''), 'deliver');
  v_n    integer := 0;
BEGIN
  IF v_me IS NULL THEN
    RAISE EXCEPTION 'chit_line_event: no entity context — call inside withEntity(me)';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM chit_header WHERE chit_id = p_chit_id AND entity_id = v_me) THEN
    RAISE EXCEPTION 'chit_line_event: % is not a participant of chit %', v_me, p_chit_id;
  END IF;
  IF v_kind NOT IN ('deliver', 'add') THEN
    RAISE EXCEPTION 'chit_line_event: kind must be deliver or add, got %', p_kind;
  END IF;
  IF v_kind = 'deliver' AND (p_qty IS NULL OR p_qty = 0) THEN
    RAISE EXCEPTION 'chit_line_event: a delivery needs a non-zero quantity (a negative value corrects an earlier one)';
  END IF;
  IF v_kind = 'add' AND COALESCE(p_qty, 0) = 0 AND COALESCE(p_amount, 0) = 0 THEN
    RAISE EXCEPTION 'chit_line_event: an added event needs a quantity or an amount — otherwise it records nothing';
  END IF;
  IF v_kind = 'add' AND COALESCE(btrim(p_particulars), '') = '' THEN
    RAISE EXCEPTION 'chit_line_event: an added event must say what it was for (particulars)';
  END IF;

  SELECT display_name INTO v_name FROM identities WHERE identity_id = v_me;

  INSERT INTO chit_line_delivery
    (chit_id, entity_id, line_id, recorded_by_entity_id, recorded_by_name,
     recorded_by_actor_id, recorded_by_actor_name, quantity, unit, reference, note,
     kind, amount, particulars, client_ref)
  SELECT p_chit_id, s.entity_id, p_line_id, v_me, v_name, p_actor_id, p_actor_name,
         COALESCE(p_qty, 0), p_unit,
         p_reference, p_note,
         v_kind, p_amount, NULLIF(btrim(p_particulars), ''), NULLIF(btrim(p_client_ref), '')
    FROM (SELECT DISTINCT entity_id FROM chit_status WHERE chit_id = p_chit_id) s
  ON CONFLICT (entity_id, chit_id, line_id, client_ref) WHERE client_ref IS NOT NULL DO NOTHING;

  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n;
END $$;

GRANT EXECUTE ON FUNCTION chit_line_event(uuid, uuid, numeric, text, text, text, uuid, text, text, numeric, text, text) TO cb_app;

-- the 11-argument door stays (code already deployed calls it) — one implementation, two doors, no key
CREATE OR REPLACE FUNCTION chit_line_event(
  p_chit_id uuid, p_line_id uuid, p_qty numeric, p_unit text,
  p_reference text, p_note text, p_actor_id uuid, p_actor_name text,
  p_kind text, p_amount numeric, p_particulars text)
RETURNS integer
LANGUAGE sql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
  SELECT chit_line_event($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, NULL::text);
$$;

GRANT EXECUTE ON FUNCTION chit_line_event(uuid, uuid, numeric, text, text, text, uuid, text, text, numeric, text) TO cb_app;
