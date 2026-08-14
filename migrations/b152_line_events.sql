-- ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════
-- b152 — a line EVENT carries money and direction. Delivery and service are one mechanism, read two ways.
-- ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════
--
-- Athi, 2026-08-14: *"assume a car service and it breaks down into multiple lines of service, then it adds more
-- information like adding brake oil, brake shoe and so on, all should be accumulated under a line item. Here it
-- is the reverse, both are nothing but the same… if we can create multiple part deliveries, the same mechanism
-- works the other way as well."*
--
-- He is right, and the storage does not change at all. A line is not a row, it is a SPINE. Events hang off it and
-- accumulate. The only thing that differs is what the line's own quantity MEANS:
--
--     GOODS    `quantity` is a COMMITMENT.  Events draw it down.   100 kg ordered, events 40 + 60, pending 0.
--     SERVICE  `quantity` is an ESTIMATE, or nothing.  Events accrue upward.  Brake job opens; oil, shoe, labour.
--
-- Same table, same summation, opposite reading.
--
-- ── ⭐ WHY THE MIXED-UNIT RULE HAD TO LAND FIRST (a4f59bd) ──────────────────────────────────────────────────────
-- A service line is INHERENTLY mixed-unit — brake oil 1 litre, brake shoe 2 piece, labour 1.5 hours. Those must
-- never collapse into "4.5". The unit rule shipped this morning as a defensive fix is the primitive that makes
-- this direction possible at all: `other_units` already keeps each unit apart with its own total and refuses to
-- invent a combined one. Without it, the first service line would have produced a meaningless number.
--
-- ── WHAT THIS ADDS ─────────────────────────────────────────────────────────────────────────────────────────────
-- 1. `amount`      — the money consequence of the event. Signed, like quantity.
-- 2. `kind`        — 'deliver' draws down the ordered quantity; 'add' accrues and does NOT.
-- 3. `particulars` — WHAT the event was about, when the line above cannot say it.
--
-- ⚠️ ONLY TWO KINDS, AND THAT IS DELIBERATE. 'part' vs 'labour' vs 'consumable' would be labels that change no
-- arithmetic — and a closed vocabulary earns its CHECK constraint only where the value alters behaviour. Direction
-- alters behaviour; category does not. Category belongs in `particulars`, which is free.
--
-- ⚠️ NO CURRENCY COLUMN, MATCHING `chit_line.price`, WHICH ALSO HAS NONE. Currency is the entity's today. Adding
-- it here alone would create a second, contradictory answer on the same chit. It belongs to the currency thread
-- (BACKLOG-currency-governance.md) and should land on the line and the event together or not at all. FLAGGED.
--
-- ⚠️ AN `add` EVENT IS A LEAF, NOT A CHILD LINE. It names a thing, a quantity and a cost — which looks like a
-- line item, and is not one. It has no deliveries of its own, no assignment, no amendment history, no per-copy
-- negotiation. The moment something needs to be delivered against, approved, or amended separately, it must be a
-- real line created by an AMENDMENT — the machinery for which already exists. Making events into child lines
-- turns every existing mechanism recursive, and that is where this design would die.
--
-- Safe to re-run. Additive: every existing row becomes kind='deliver' with a null amount, which is exactly what
-- it already meant.

ALTER TABLE chit_line_delivery ADD COLUMN IF NOT EXISTS amount      numeric(18,2);
ALTER TABLE chit_line_delivery ADD COLUMN IF NOT EXISTS particulars text;
ALTER TABLE chit_line_delivery ADD COLUMN IF NOT EXISTS kind        text NOT NULL DEFAULT 'deliver';

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chit_line_delivery_kind_chk') THEN
    ALTER TABLE chit_line_delivery
      ADD CONSTRAINT chit_line_delivery_kind_chk CHECK (kind IN ('deliver', 'add'));
  END IF;
END $$;

-- ── ⭐ chit_line_event — the honest name, now that it runs both directions ─────────────────────────────────────
-- ⚠️ SAME SECURITY POSTURE AS b144/b150, UNCHANGED: SECURITY DEFINER because the row must land in EVERY
-- participant's copy (a plain INSERT under RLS reaches only my own side, and the counterparty never sees the
-- claim); the participant gate is identical; and the fan-out is over DISTINCT entity_id, which is the b150 fix —
-- one row per PARTY however many copies that party holds. None of that is relaxed here.
CREATE OR REPLACE FUNCTION chit_line_event(
  p_chit_id uuid, p_line_id uuid, p_qty numeric, p_unit text,
  p_reference text, p_note text, p_actor_id uuid, p_actor_name text,
  p_kind text, p_amount numeric, p_particulars text)
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

  /**
   * ⚠️ THE ZERO RULE DIFFERS BY KIND, AND THAT IS NOT A LOOSENING.
   *
   * A 'deliver' still needs a non-zero quantity — a delivery of nothing is not a claim about goods, and b144
   * refuses it for that reason. An 'add' may legitimately carry quantity 0 (a diagnostic fee, a call-out charge:
   * money with no thing) but then it MUST carry money, or the row asserts nothing at all. So each kind must say
   * SOMETHING; neither may say nothing.
   */
  IF v_kind = 'deliver' AND (p_qty IS NULL OR p_qty = 0) THEN
    RAISE EXCEPTION 'chit_line_event: a delivery needs a non-zero quantity (a negative value corrects an earlier one)';
  END IF;
  IF v_kind = 'add' AND COALESCE(p_qty, 0) = 0 AND COALESCE(p_amount, 0) = 0 THEN
    RAISE EXCEPTION 'chit_line_event: an added event needs a quantity or an amount — otherwise it records nothing';
  END IF;
  /* An 'add' that names nothing cannot be read back: the line above describes the job, not the part fitted. */
  IF v_kind = 'add' AND COALESCE(btrim(p_particulars), '') = '' THEN
    RAISE EXCEPTION 'chit_line_event: an added event must say what it was for (particulars)';
  END IF;

  SELECT display_name INTO v_name FROM identities WHERE identity_id = v_me;

  INSERT INTO chit_line_delivery
    (chit_id, entity_id, line_id, recorded_by_entity_id, recorded_by_name,
     recorded_by_actor_id, recorded_by_actor_name, quantity, unit, reference, note,
     kind, amount, particulars)
  SELECT p_chit_id, s.entity_id, p_line_id, v_me, v_name, p_actor_id, p_actor_name,
         COALESCE(p_qty, 0), p_unit,
         p_reference, p_note,
         v_kind, p_amount, NULLIF(btrim(p_particulars), '')
    FROM (SELECT DISTINCT entity_id FROM chit_status WHERE chit_id = p_chit_id) s;

  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n;
END $$;

GRANT EXECUTE ON FUNCTION chit_line_event(uuid, uuid, numeric, text, text, text, uuid, text, text, numeric, text) TO cb_app;

-- ── the b144/b150 signature stays, delegating ─────────────────────────────────────────────────────────────────
-- ⚠️ KEPT, NOT REPLACED. Code already deployed calls the 8-argument form, and a migration that removes it breaks
-- every request in the window between running this and the next deploy. It is one implementation with two doors,
-- not a second implementation — the duplicate-function trap avoided by delegation.
CREATE OR REPLACE FUNCTION chit_line_deliver(
  p_chit_id uuid, p_line_id uuid, p_qty numeric, p_unit text,
  p_reference text, p_note text, p_actor_id uuid, p_actor_name text)
RETURNS integer
LANGUAGE sql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
  SELECT chit_line_event($1, $2, $3, $4, $5, $6, $7, $8, 'deliver', NULL, NULL);
$$;

GRANT EXECUTE ON FUNCTION chit_line_deliver(uuid, uuid, numeric, text, text, text, uuid, text) TO cb_app;

-- ⭐ The guard the amendable-partial decision needs, at the DB level as well as in lib/amend.js.
-- Athi, 2026-08-14: *"partial delivery can be amendable, that is what makes it interesting."* Agreed — but an
-- amendment must never take an ordered quantity BELOW what has already gone out. That is not an amendment, it is
-- a return, and it needs a negative event so both the original and the correction stay on the record. Without
-- this, "amendable" becomes a quiet way to make delivered goods disappear.
CREATE OR REPLACE FUNCTION chit_line_delivered_qty(p_chit_id uuid, p_line_id uuid)
RETURNS numeric
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  /* ⚠️ ONLY 'deliver', and only in the LINE'S OWN UNIT — the same rule lib/deliverline.js enforces. An 'add'
     never draws down, and 12 pieces are not 12 kg. A guard that counted them would block a legitimate amendment
     using a number that was never true. */
  SELECT COALESCE(SUM(d.quantity), 0)
    FROM chit_line_delivery d
    JOIN chit_line l
      ON l.entity_id = d.entity_id AND l.chit_id = d.chit_id AND l.line_id = d.line_id
   WHERE d.chit_id = p_chit_id
     AND d.line_id = p_line_id
     AND d.kind = 'deliver'
     AND COALESCE(NULLIF(btrim(lower(d.unit)), ''), btrim(lower(COALESCE(l.unit, ''))))
       = btrim(lower(COALESCE(l.unit, '')));
$$;

GRANT EXECUTE ON FUNCTION chit_line_delivered_qty(uuid, uuid) TO cb_app;

DO $$
BEGIN
  RAISE NOTICE 'b152: line events carry kind/amount/particulars. Existing rows are kind=deliver, amount NULL — unchanged in meaning.';
  RAISE NOTICE 'b152: chit_line_deliver() still works; it now delegates to chit_line_event().';
END $$;
