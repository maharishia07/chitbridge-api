-- ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════
-- b147 — THE SERVICE CLOCK. A chit becomes a service request, and a PAUSE becomes a co-held, disputable fact.
-- ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════
--
-- Athi, 2026-08-13: *"do you think our model is a better match for ITIL, as both the parties in agreement or
-- disagreement in resolution?"*
--
-- ── ⭐ THE ANSWER IS NARROWER AND STRONGER THAN "BOTH PARTIES AGREE" ─────────────────────────────────────────────
-- In every service-management tool, resolution is asserted by ONE side. The desk marks it Resolved; the customer
-- accepts or reopens. The disagreement never enters the data — a reopen looks like a new event, not like two
-- parties differing about the same one.
--
-- But the real fight is never the resolution. IT IS THE PAUSE. A breach is arithmetic once you agree on the
-- pauses, and every SLA argument reduces to "was that pause legitimate" — the desk says the clock stopped while
-- waiting on the customer, the customer says nobody asked them anything, and the tool that adjudicates belongs to
-- one of them.
--
-- So the PAUSE is what this migration makes co-held and disputable, not the resolution. It is replicated into
-- every participant's copy exactly like a per-line delivery (b144), it records WHO claimed it, and the
-- counterparty can accept or reject it on their own copy. lib/sla.js then computes the clock BOTH WAYS —
-- `as_agreed` (every pause honoured) and `contested` (rejected pauses removed) — and says when the two answers
-- differ. Showing one number is taking a side; showing both from one record is the thing no single-tenant service
-- desk can do.
--
-- ── ⚠️ WHAT THIS DOES NOT DO ────────────────────────────────────────────────────────────────────────────────────
-- Nothing auto-resolves, auto-accepts a pause or auto-breaches. The arithmetic lives in lib/sla.js and is pure;
-- these tables only hold the facts it reads. Same discipline as the matcher: a confident wrong number is worse
-- than a gap, because a gap gets checked.
--
-- ⚠️ NO SERVICE CALENDAR YET, AND THAT IS STATED RATHER THAN FUDGED. Real SLAs run against business hours
-- ("9–6 Mon–Fri, excluding holidays"), and a 24×7 clock will over-report elapsed time on any contract that is
-- not 24×7. `policy` has room for a calendar and lib/sla.js does not read one — so today this is correct for
-- 24×7 support and OPTIMISTIC for anything else. Do not sell a business-hours SLA on it until that lands.
--
-- Safe to re-run.

-- ── 1 · the service facts on a chit ─────────────────────────────────────────────────────────────────────────────
-- ⚠️ PER-COPY, like everything else. My priority and my policy are mine; the counterparty may hold different ones,
-- and that is not a bug — an internal P1 is often a supplier's P3, and pretending otherwise hides the mismatch
-- that causes the argument.
CREATE TABLE IF NOT EXISTS chit_sla (
  chit_id        uuid NOT NULL,
  entity_id      uuid NOT NULL,

  -- Impact and urgency are kept SEPARATELY and the priority derived. Collapsing them into one dropdown is how
  -- every ticket becomes a P1: they answer genuinely different questions (how much is affected · how fast it
  -- degrades) and only one of them is usually arguable.
  impact         text,
  urgency        text,
  priority       text,                       -- P1..P4, derived by lib/sla.priorityOf unless explicitly overridden

  raised_at      timestamptz NOT NULL DEFAULT now(),
  responded_at   timestamptz,
  resolved_at    timestamptz,
  closed_at      timestamptz,

  -- ⚠️ RESOLUTION AND CLOSURE ARE DIFFERENT COLUMNS. Resolution says WHAT was done; closure says the requester
  -- accepted it. Collapsing them loses the gap between "we fixed it" and "they agree we fixed it" — which is the
  -- exact gap this product exists to hold.
  resolution_code text,
  resolution_note text,
  closed_by_counterparty boolean,

  -- Per-entity target overrides: { "P1": { "respond": 5, "resolve": 120 }, … }. Absent = lib/sla defaults.
  policy         jsonb,

  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (entity_id, chit_id)
);

CREATE INDEX IF NOT EXISTS chit_sla_open ON chit_sla (entity_id, priority) WHERE resolved_at IS NULL;

ALTER TABLE chit_sla ENABLE ROW LEVEL SECURITY;
ALTER TABLE chit_sla FORCE  ROW LEVEL SECURITY;
DROP POLICY IF EXISTS chit_sla_isolation ON chit_sla;
CREATE POLICY chit_sla_isolation ON chit_sla
  USING       (entity_id = current_setting('app.current_entity', true)::uuid)
  WITH CHECK  (entity_id = current_setting('app.current_entity', true)::uuid);
GRANT SELECT, INSERT, UPDATE, DELETE ON chit_sla TO cb_app;

-- ── 2 · ⭐ THE PAUSE — co-held, attributed, disputable ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS chit_sla_pause (
  row_id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  chit_id        uuid NOT NULL,
  entity_id      uuid NOT NULL,
  -- ⚠️ SHARED ACROSS COPIES, exactly like b142's line_id. Both parties must be able to name the SAME pause, or
  -- "I reject that pause" cannot be attached to anything.
  pause_id       uuid NOT NULL,

  paused_from    timestamptz NOT NULL,
  paused_to      timestamptz,                -- NULL = still paused. lib/sla clamps an open pause to now.

  reason         text NOT NULL,              -- lib/sla.PAUSE_REASONS
  note           text,
  -- Whether the clock was stopped ON the counterparty. This is the claim that gets argued about.
  on_counterparty boolean NOT NULL DEFAULT false,

  claimed_by_entity_id uuid NOT NULL,        -- whose claim this is — what makes "they rejected it" meaningful
  claimed_by_name      text,

  -- ⚠️ THREE STATES, NOT A BOOLEAN. NULL = not answered yet, and that is NOT rejection: silence must never strip a
  -- pause out of the clock, or a desk breaches because a customer has not read their email.
  accepted       boolean,
  accepted_at    timestamptz,
  accepted_by    text,

  created_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (entity_id, chit_id, pause_id)
);

CREATE INDEX IF NOT EXISTS chit_sla_pause_chit ON chit_sla_pause (entity_id, chit_id, paused_from);
CREATE INDEX IF NOT EXISTS chit_sla_pause_open ON chit_sla_pause (entity_id, chit_id) WHERE paused_to IS NULL;

ALTER TABLE chit_sla_pause ENABLE ROW LEVEL SECURITY;
ALTER TABLE chit_sla_pause FORCE  ROW LEVEL SECURITY;
DROP POLICY IF EXISTS chit_sla_pause_isolation ON chit_sla_pause;
CREATE POLICY chit_sla_pause_isolation ON chit_sla_pause
  USING       (entity_id = current_setting('app.current_entity', true)::uuid)
  WITH CHECK  (entity_id = current_setting('app.current_entity', true)::uuid);
GRANT SELECT, INSERT, UPDATE, DELETE ON chit_sla_pause TO cb_app;

-- ── 3 · the co-held write, gated exactly like chit_line_deliver ─────────────────────────────────────────────────
-- ⚠️ SECURITY DEFINER, AND THE GATE IS THE WHOLE SAFETY ARGUMENT: the caller must already be a participant of this
-- chit, checked against their OWN row, before anything crosses into another copy. Without that check this
-- function is a way to write into a stranger's record. Copied deliberately from b144 rather than improvised.
CREATE OR REPLACE FUNCTION chit_sla_pause_start(
  p_chit_id uuid, p_pause_id uuid, p_from timestamptz, p_reason text, p_note text, p_on_counterparty boolean)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_me uuid := NULLIF(current_setting('app.current_entity', true), '')::uuid;
  v_name text;
  v_n integer := 0;
BEGIN
  IF v_me IS NULL THEN
    RAISE EXCEPTION 'chit_sla_pause_start: no entity context — call inside withEntity(me)';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM chit_header WHERE chit_id = p_chit_id AND entity_id = v_me) THEN
    RAISE EXCEPTION 'chit_sla_pause_start: % is not a participant of chit %', v_me, p_chit_id;
  END IF;

  SELECT display_name INTO v_name FROM identities WHERE identity_id = v_me;

  INSERT INTO chit_sla_pause
    (chit_id, entity_id, pause_id, paused_from, reason, note, on_counterparty, claimed_by_entity_id, claimed_by_name)
  SELECT p_chit_id, s.entity_id, p_pause_id, COALESCE(p_from, now()), p_reason, p_note,
         COALESCE(p_on_counterparty, false), v_me, v_name
    FROM chit_status s
   WHERE s.chit_id = p_chit_id
  ON CONFLICT (entity_id, chit_id, pause_id) DO NOTHING;

  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n;
END $$;

-- Ending a pause is the same act on the same row in every copy.
CREATE OR REPLACE FUNCTION chit_sla_pause_end(p_chit_id uuid, p_pause_id uuid, p_to timestamptz)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_me uuid := NULLIF(current_setting('app.current_entity', true), '')::uuid;
  v_n integer := 0;
BEGIN
  IF v_me IS NULL THEN RAISE EXCEPTION 'chit_sla_pause_end: no entity context'; END IF;
  IF NOT EXISTS (SELECT 1 FROM chit_header WHERE chit_id = p_chit_id AND entity_id = v_me) THEN
    RAISE EXCEPTION 'chit_sla_pause_end: % is not a participant of chit %', v_me, p_chit_id;
  END IF;
  /* ⚠️ ONLY AN OPEN PAUSE CLOSES. Re-ending a closed pause would move its end time and silently rewrite how much
     of the clock was stopped — the one number both parties are watching. */
  UPDATE chit_sla_pause
     SET paused_to = COALESCE(p_to, now())
   WHERE chit_id = p_chit_id AND pause_id = p_pause_id AND paused_to IS NULL;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n;
END $$;

-- ⭐ Accept or reject someone else's pause. This is the disagreement, made into a fact.
CREATE OR REPLACE FUNCTION chit_sla_pause_answer(p_chit_id uuid, p_pause_id uuid, p_accepted boolean, p_by text)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_me uuid := NULLIF(current_setting('app.current_entity', true), '')::uuid;
  v_n integer := 0;
BEGIN
  IF v_me IS NULL THEN RAISE EXCEPTION 'chit_sla_pause_answer: no entity context'; END IF;
  IF NOT EXISTS (SELECT 1 FROM chit_header WHERE chit_id = p_chit_id AND entity_id = v_me) THEN
    RAISE EXCEPTION 'chit_sla_pause_answer: % is not a participant of chit %', v_me, p_chit_id;
  END IF;
  /* ⚠️ YOU CANNOT ANSWER YOUR OWN PAUSE. A desk accepting its own "waiting on customer" claim would make the
     contested view identical to the agreed one, and the whole mechanism would report agreement that never
     happened. The claim and the answer must come from different parties. */
  IF EXISTS (SELECT 1 FROM chit_sla_pause
              WHERE chit_id = p_chit_id AND pause_id = p_pause_id AND claimed_by_entity_id = v_me
              LIMIT 1) THEN
    RAISE EXCEPTION 'chit_sla_pause_answer: a party cannot answer its own pause claim';
  END IF;

  UPDATE chit_sla_pause
     SET accepted = p_accepted, accepted_at = now(), accepted_by = p_by
   WHERE chit_id = p_chit_id AND pause_id = p_pause_id;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n;
END $$;

GRANT EXECUTE ON FUNCTION chit_sla_pause_start(uuid, uuid, timestamptz, text, text, boolean) TO cb_app;
GRANT EXECUTE ON FUNCTION chit_sla_pause_end(uuid, uuid, timestamptz) TO cb_app;
GRANT EXECUTE ON FUNCTION chit_sla_pause_answer(uuid, uuid, boolean, text) TO cb_app;

COMMENT ON TABLE chit_sla_pause IS
  'b147 — SLA pauses, SHARED. Replicated into every participant copy like b144 deliveries. claimed_by_entity_id says whose claim it is and `accepted` (NULL = unanswered, not rejected) is the counterparty''s answer — which is what lets lib/sla.js compute the clock as_agreed AND contested. The pause is the disputed object; a breach is arithmetic once the pauses are settled.';

DO $$
DECLARE n bigint; p bigint;
BEGIN
  SELECT count(*) INTO n FROM chit_sla;
  SELECT count(*) INTO p FROM chit_sla_pause;
  RAISE NOTICE 'b147: chit_sla % row(s), chit_sla_pause % row(s), both WITH RLS (FORCE). Nothing was deleted.', n, p;
  RAISE NOTICE 'b147: no service calendar — the clock is 24x7 and will OVER-report elapsed time on a business-hours SLA.';
END $$;
