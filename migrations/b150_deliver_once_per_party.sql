-- ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════
-- b150 — a delivery lands ONCE per party, not once per copy.
-- ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════
--
-- Found 2026-08-14 seeding ten realistic chits into a real account, and it is a MONEY-AND-GOODS bug, not a display
-- one:
--
--     Groundnut Oil   ordered 10   delivered 20      <- exactly double
--     Salt Crystal    ordered 20   delivered 40      <- exactly double
--
-- b144's chit_line_deliver fans a delivery out with `FROM chit_status s WHERE s.chit_id = p_chit_id` — one row per
-- STATUS ROW. That is right when every status row is a different party, and wrong the moment one entity holds more
-- than one copy of the same chit. A self-chit with self_copy_pref='both' holds exactly that: a `sent` row and a
-- `received` row, both for the SAME entity. So every delivery was written twice against itself, and `delivered`,
-- `pending`, `complete` and `over` were all computed from a doubled figure.
--
-- ⚠️ WHY IT WAS INVISIBLE. Doubling looks like data, not like an error. A line reads "complete" one delivery early,
-- which is the direction nobody questions — you stop chasing something that says it has arrived. It would have
-- surfaced first as a customer saying they were short.
--
-- ⚠️ AND IT IS THE SAME ROOT CAUSE AS THE WORKLIST DOUBLING, in a second place. There the fix was a LATERAL join
-- (reading twice); here rows are actually WRITTEN twice. b149 stops new self-chits from having two copies, which
-- removes the trigger — this removes the fault, so a legitimately double-copied chit cannot corrupt an arithmetic
-- that both parties rely on.
--
-- FIX: fan out over DISTINCT entity_id. One party, one row, however many copies that party happens to hold.
--
-- ⚠️ EXISTING ROWS ARE NOT DEDUPLICATED HERE. A delivery row is a claim someone made, and deleting claims is not
-- something a migration should do quietly — a correcting entry is the honest instrument, and it belongs to the
-- person who owns the record. The query to FIND affected lines is at the bottom, to be run and judged first.
--
-- Safe to re-run.

CREATE OR REPLACE FUNCTION chit_line_deliver(
  p_chit_id uuid, p_line_id uuid, p_qty numeric, p_unit text,
  p_reference text, p_note text, p_actor_id uuid, p_actor_name text)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_me   uuid := NULLIF(current_setting('app.current_entity', true), '')::uuid;
  v_name text;
  v_n    integer := 0;
BEGIN
  IF v_me IS NULL THEN
    RAISE EXCEPTION 'chit_line_deliver: no entity context — call inside withEntity(me)';
  END IF;
  -- The gate is unchanged: a non-participant cannot reach any other copy.
  IF NOT EXISTS (SELECT 1 FROM chit_header WHERE chit_id = p_chit_id AND entity_id = v_me) THEN
    RAISE EXCEPTION 'chit_line_deliver: % is not a participant of chit %', v_me, p_chit_id;
  END IF;
  IF p_qty IS NULL OR p_qty = 0 THEN
    RAISE EXCEPTION 'chit_line_deliver: quantity must be non-zero (a negative value corrects an earlier delivery)';
  END IF;

  SELECT display_name INTO v_name FROM identities WHERE identity_id = v_me;

  -- ⭐ DISTINCT — one row per PARTY. The old form wrote one per chit_status row, so an entity holding two copies of
  -- its own chit recorded every delivery twice and read back double what was delivered.
  INSERT INTO chit_line_delivery
    (chit_id, entity_id, line_id, recorded_by_entity_id, recorded_by_name,
     recorded_by_actor_id, recorded_by_actor_name, quantity, unit, reference, note)
  SELECT p_chit_id, s.entity_id, p_line_id, v_me, v_name, p_actor_id, p_actor_name,
         p_qty, p_unit, p_reference, p_note
    FROM (SELECT DISTINCT entity_id FROM chit_status WHERE chit_id = p_chit_id) s;

  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n;
END $$;

GRANT EXECUTE ON FUNCTION chit_line_deliver(uuid, uuid, numeric, text, text, text, uuid, text) TO cb_app;

DO $$
DECLARE dup bigint;
BEGIN
  SELECT count(*) INTO dup FROM (
    SELECT chit_id, entity_id, line_id, quantity, unit, delivered_at, count(*) AS n
      FROM chit_line_delivery
     GROUP BY chit_id, entity_id, line_id, quantity, unit, delivered_at
    HAVING count(*) > 1) x;
  RAISE NOTICE 'b150: future deliveries land once per party.';
  RAISE NOTICE 'b150: % existing line(s) look duplicated — NOT touched. Inspect before correcting; a delivery row is a claim, and claims are corrected with a correcting entry, not deleted.', dup;
END $$;

-- ── To SEE what was affected (run separately, judge before acting) ──────────────────────────────────────────────
--   SELECT chit_id, line_id, quantity, unit, delivered_at, count(*) AS copies
--     FROM chit_line_delivery
--    GROUP BY chit_id, entity_id, line_id, quantity, unit, delivered_at
--   HAVING count(*) > 1
--    ORDER BY delivered_at DESC;
--
-- A duplicate is corrected the way b144 intends — a NEGATIVE delivery for the excess, which leaves both the
-- original and the correction on the record.
