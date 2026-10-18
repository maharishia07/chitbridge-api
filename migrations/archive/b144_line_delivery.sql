-- ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════
-- b144 — PER-LINE DELIVERY. Shared, partial, and recorded by either side.
-- ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════
--
-- Athi, 2026-08-12: per-line assignment PRIVATE, per-line delivery SHARED. This is the shared half.
--
-- ── ⚠️ PARTIAL IS THE NORMAL CASE, NOT THE EXCEPTION ────────────────────────────────────────────────────────────
-- 6 kg on Friday and 4 kg on Saturday are TWO ROWS. "6 of 10 · 4 pending" is DERIVED by summing them — there is no
-- `delivered_qty` column anywhere, deliberately. A stored total is a second answer to the same question, and it
-- drifts the first time somebody corrects a delivery. Same rule as the live set: compute it, never store it.
--
-- ── ⚠️ REPLICATED PER COPY, NOT SHARED BY REFERENCE ─────────────────────────────────────────────────────────────
-- CB's core principle: never share OWNED data — replicate anything mutable or disputable, share-read only
-- immutable refs. A delivery claim is the most disputable thing on the rail, so each party records into their OWN
-- copy under their OWN entity_id, and RLS needs no special case. `recorded_by_entity_id` says WHOSE claim it is.
--
-- ⭐ THAT IS ALSO WHAT MAKES "BOTH AGREE" MEAN ANYTHING. Two independent claims that match is far stronger than
-- one person's tick — it is the one place co-holding earns its keep, and it costs almost nothing here. Divergence
-- ("they recorded a delivery you have not") is SURFACED, never resolved: CB takes no side and blocks nothing.
--
-- ── ⚠️ EXCESS IS RECORDED, NEVER REJECTED ───────────────────────────────────────────────────────────────────────
-- Delivering 11 kg against an order of 10 is normal — a round number, an extra crate. Refusing it would make the
-- record disagree with the lorry. It is stored and the excess is shown.
--
-- ── ⚠️ AND IT IS IMMUTABLE ──────────────────────────────────────────────────────────────────────────────────────
-- To correct a delivery you add a correcting row (a negative quantity), never an edit. The same discipline as
-- amendments: what was claimed on the day has to stay legible after somebody changes their mind.
--
-- Safe to re-run.

CREATE TABLE IF NOT EXISTS chit_line_delivery (
  delivery_id   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  chit_id       uuid NOT NULL,
  entity_id     uuid NOT NULL,              -- whose COPY this row lives in (RLS scope)
  line_id       uuid NOT NULL,

  -- ⚠️ WHOSE CLAIM IT IS. Both parties' claims are replicated into both copies, so without this a reader cannot
  -- tell "I recorded this" from "they did" — which is the entire basis of the both-agree signal.
  recorded_by_entity_id   uuid NOT NULL,
  recorded_by_name        text,
  recorded_by_actor_id    uuid,
  recorded_by_actor_name  text,

  -- ⚠️ SIGNED. A negative quantity is a correcting entry, which is how a delivery is undone without deleting the
  -- claim that it happened. Sums stay honest and the history stays readable.
  quantity      numeric(18,3) NOT NULL,
  unit          text,

  -- ⚠️ FREE TEXT, NEVER PARSED, NEVER MATCHED. "signed by their boy", a docket number, "left at the gate" — all
  -- equally valid. A system that decided two references were "the same delivery" would be making a claim about
  -- goods it cannot stand behind.
  reference     text,
  note          text,

  delivered_at  timestamptz NOT NULL DEFAULT now(),
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS chit_line_delivery_line ON chit_line_delivery (entity_id, chit_id, line_id, delivered_at);
CREATE INDEX IF NOT EXISTS chit_line_delivery_who  ON chit_line_delivery (entity_id, recorded_by_entity_id);

ALTER TABLE chit_line_delivery ENABLE ROW LEVEL SECURITY;
ALTER TABLE chit_line_delivery FORCE  ROW LEVEL SECURITY;
DROP POLICY IF EXISTS chit_line_delivery_isolation ON chit_line_delivery;
CREATE POLICY chit_line_delivery_isolation ON chit_line_delivery
  USING       (entity_id = current_setting('app.current_entity', true)::uuid)
  WITH CHECK  (entity_id = current_setting('app.current_entity', true)::uuid);
GRANT SELECT, INSERT, UPDATE, DELETE ON chit_line_delivery TO cb_app;

-- ── the replicating writer ──────────────────────────────────────────────────────────────────────────────────────
-- ⚠️ SECURITY DEFINER, GATED THE SAME WAY chit_deliver IS. It writes one row into EVERY participant's copy, so a
-- delivery I record appears on their side too — that is what "shared" means here. The gate is the whole safety
-- argument: the caller must already be a participant of this chit, checked against their OWN row before anything
-- crosses. Without that check this function would be a way to write into a stranger's copy.
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
  -- The gate. A non-participant cannot reach any other copy.
  IF NOT EXISTS (SELECT 1 FROM chit_header WHERE chit_id = p_chit_id AND entity_id = v_me) THEN
    RAISE EXCEPTION 'chit_line_deliver: % is not a participant of chit %', v_me, p_chit_id;
  END IF;
  IF p_qty IS NULL OR p_qty = 0 THEN
    RAISE EXCEPTION 'chit_line_deliver: quantity must be non-zero (a negative value corrects an earlier delivery)';
  END IF;

  SELECT display_name INTO v_name FROM identities WHERE identity_id = v_me;

  -- One row per participant copy. Every party ends up holding the same claim, attributed to whoever made it.
  INSERT INTO chit_line_delivery
    (chit_id, entity_id, line_id, recorded_by_entity_id, recorded_by_name,
     recorded_by_actor_id, recorded_by_actor_name, quantity, unit, reference, note)
  SELECT p_chit_id, s.entity_id, p_line_id, v_me, v_name, p_actor_id, p_actor_name,
         p_qty, p_unit, p_reference, p_note
    FROM chit_status s
   WHERE s.chit_id = p_chit_id;

  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n;
END $$;

GRANT EXECUTE ON FUNCTION chit_line_deliver(uuid, uuid, numeric, text, text, text, uuid, text) TO cb_app;

COMMENT ON TABLE chit_line_delivery IS
  'b144 — per-line deliveries, SHARED. Replicated into every participant copy (RLS per copy); recorded_by_entity_id says whose claim it is, which is what makes "both agree" meaningful. Partial is normal — totals are SUMMED, never stored. Negative quantity = a correcting entry; rows are never edited or deleted.';

DO $$
BEGIN
  RAISE NOTICE 'b144: chit_line_delivery created WITH RLS (FORCE) + chit_line_deliver() replicating writer. Totals are derived, never stored.';
END $$;
