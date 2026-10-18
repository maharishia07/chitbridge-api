-- ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════
-- b143 — PER-LINE ASSIGNMENT. Division of labour, and it is PRIVATE.
-- ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════
--
-- Athi, 2026-08-12: *"for each line item if we can assign to an assist, a date and may be few others it will start
-- behaving like a division of labour — so multiple people, devices or anything it can work at the same time."*
-- And, decided the same day: **per-line assignment PRIVATE, per-line delivery SHARED.**
--
-- ── ⚠️ PRIVATE MEANS PRIVATE ────────────────────────────────────────────────────────────────────────────────────
-- Kumar must never learn that Murugan has his onions. Who does the work is the seller's internal business and
-- disclosing it would leak headcount, capacity and who is behind on what. WITH RLS (FORCE), entity-scoped, and it
-- is never joined into any co-held read: `chit_participants` and the delivery path do not touch this table.
--
-- ── ⚠️ THE TWO-SOURCES HAZARD, HANDLED EXPLICITLY ───────────────────────────────────────────────────────────────
-- `chit_status.assigned_to_actor_id` ALREADY EXISTS — whole-chit assignment, and routes/actors.js maintains it.
-- Adding per-line assignment creates a second answer to "who has this", and two answers to one question is the
-- failure mode this whole design keeps trying to avoid.
-- THE RULE: chit-level assignment is Design 1 (the chit is the unit of work). Line-level is Design 2. **A chit
-- either has line assignments or it does not.** When it does, the chit-level field is IGNORED for display and the
-- header reads a DERIVED summary ("3 people"); when it does not, nothing changes and the old behaviour stands.
-- Neither is deleted, because a helpdesk ticket is genuinely whole-chit work and a vegetable order genuinely is
-- not. What is forbidden is reading both at once and believing the answer.
--
-- ── ⚠️ A CHAIN, NOT A COLUMN ────────────────────────────────────────────────────────────────────────────────────
-- Reassignment is normal ("Murugan is off, give it to Selvam") and WHO HAD IT is the question after something goes
-- wrong. Latest seq wins; every prior holder stays readable. Same shape as chit_line_amendment, deliberately —
-- one pattern for "current value plus how it got there" instead of two.
--
-- ⚠️ assignee_actor_id NULL is a real state: explicitly UNASSIGNED. It is not the same as never assigned, which is
-- the absence of any row — "nobody has picked this up" and "we took it off Murugan" are different facts.
--
-- Safe to re-run.

CREATE TABLE IF NOT EXISTS chit_line_assignment (
  assignment_id  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  chit_id        uuid NOT NULL,
  entity_id      uuid NOT NULL,
  line_id        uuid NOT NULL,
  seq            integer NOT NULL,

  -- NULL = deliberately unassigned. See the note above.
  assignee_actor_id  uuid,
  -- ⚠️ SNAPSHOT, NOT A JOIN. A co-assist who later leaves must not blank out the history of who held what; "it was
  -- Murugan" has to stay legible after Murugan is gone from the roster.
  assignee_name      text,
  -- 'human' | 'ai' — copied from identities.actor_type at assign time so the roll-up can separate people from
  -- co-assists without joining a table this one must never depend on.
  assignee_type      text,

  -- What they are doing with it: packing, loading, sourcing. Free text ON PURPOSE — every trade names its own
  -- steps, and an enum here would be a vertical assumption baked into the rail.
  task           text,
  due_date       date,
  note           text,

  assigned_by_actor_id uuid,
  assigned_by_name     text,
  created_at     timestamptz NOT NULL DEFAULT now(),

  UNIQUE (entity_id, chit_id, line_id, seq)
);

CREATE INDEX IF NOT EXISTS chit_line_assign_line ON chit_line_assignment (entity_id, chit_id, line_id, seq);
-- ⭐ The roll-up index: "everything Murugan owes, across every chit, due today". That query is the whole point of
-- division of labour — one person's work list assembled from twelve different customers.
CREATE INDEX IF NOT EXISTS chit_line_assign_who  ON chit_line_assignment (entity_id, assignee_actor_id, due_date);

ALTER TABLE chit_line_assignment ENABLE ROW LEVEL SECURITY;
ALTER TABLE chit_line_assignment FORCE  ROW LEVEL SECURITY;
DROP POLICY IF EXISTS chit_line_assign_isolation ON chit_line_assignment;
CREATE POLICY chit_line_assign_isolation ON chit_line_assignment
  USING       (entity_id = current_setting('app.current_entity', true)::uuid)
  WITH CHECK  (entity_id = current_setting('app.current_entity', true)::uuid);
GRANT SELECT, INSERT, UPDATE, DELETE ON chit_line_assignment TO cb_app;

COMMENT ON TABLE chit_line_assignment IS
  'b143 — who is doing which LINE. PRIVATE to the entity (WITH RLS, FORCE); never joined into any co-held read. Latest seq per line_id is current; earlier rows are the history of who held it. NULL assignee = deliberately unassigned, which is not the same as no row at all.';

DO $$
BEGIN
  RAISE NOTICE 'b143: chit_line_assignment created WITH RLS (FORCE). PRIVATE — the counterparty never sees who is doing the work.';
END $$;
