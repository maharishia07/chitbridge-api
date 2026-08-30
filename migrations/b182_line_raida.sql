-- ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════
-- b182 — RAIDA ON A LINE. What we believe, fear, owe and must do about one piece of work.
-- ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════
--
-- Athi, 2026-08-30: *"we create path for RAIDA and other elements into the current line item like cost etc so we
-- have a mechanism of connecting those"* and, on the shape: *"still in design only but much simplistic one,
-- recording facts only."*
--
-- Design and the decisions behind it: C:\dev\DESIGN-raida-and-cover.md
--
-- ── ⚠️ RAIDA ALREADY EXISTED, AS THE WRONG SHAPE ────────────────────────────────────────────────────────────────
-- `MTYPES` in the web app has carried risk · assumption · issue · dependency · action (plus decision, info, query)
-- for months, as a TAG ON A MESSAGE. A tag is a MENTION: it has no owner, no state, and no answer to "what is
-- open". And a message hangs on a CHIT, so nothing could be said about one LINE. This is the object the tag
-- should have been pointing at all along; the tags stay exactly as they are.
--
-- ── ⭐⭐ NOT A NEW MECHANISM. `chit_line_cost` (b145) IS THE PATTERN ─────────────────────────────────────────────
-- Every per-line concern in this codebase is its own table keyed (entity_id, chit_id, line_id) under FORCE RLS,
-- per copy: chit_line · chit_line_assignment · chit_line_amendment · chit_line_cost · chit_messages.line_id.
-- This is one more with the same four keys. It is deliberately NOT a generic attachment table — "everything is an
-- entity" was considered and rejected; layers stay TYPED.
--
-- ── ⭐ line_id IS NULLABLE, AND THAT IS THE SCOPE MODEL ─────────────────────────────────────────────────────────
-- Copied from b145, whose comment reads: *"NULL = a cost against the WHOLE chit (transport, a permit) rather than
-- one line."* Same here, and it is the whole of "authored at a scope, read with inheritance": the letter of credit
-- is an ORDER fact (line_id NULL); the crane is a LINE fact. Nothing had to be invented for this.
--
-- ── ⭐⭐ APPEND-ONLY. A CLOSE IS A ROW, NOT AN UPDATE ────────────────────────────────────────────────────────────
-- Also from b145: *"SIGNED, like a delivery. A negative row corrects an earlier one; nothing is edited or
-- deleted."* Here the negative amount is a CLOSING ROW — `closes_id` points at what it closes.
--
-- THIS IS WHAT MAKES "recording facts only" REACHABLE. State is COMPUTED from the log, never stored: open = a row
-- with nothing closing it. Owner, due date, probability, impact and derivation can all arrive later as columns or
-- as reads, and until they do this cannot rot into a half-built workflow. There is no status column to drift.
--
-- ── ⚠️ SIX KINDS, NOT FIVE ──────────────────────────────────────────────────────────────────────────────────────
-- `decision` is already one of MTYPES and is what a waiver becomes. The CHECK matches MTYPES exactly minus the
-- three conversational ones (info · query are messages, not register entries).
--
-- ── ⚠️ ISSUE IS ITS OWN KIND — Athi, 2026-08-30 ─────────────────────────────────────────────────────────────────
-- *"it has to be own, but if they want to link it as dispute there should be a facility to raise it as a dispute,
-- just call the dispute here."* So an issue is recorded in one tap, and raising a dispute CALLS THE EXISTING
-- dispute path — nothing about disputes is reimplemented. `dispute_id` records that it was escalated, so the
-- register can say so without joining a table it must not depend on.
--
-- ── ⚠️ PER COPY. "SHARED" MEANS REPLICATED, NOT A SHARED ROW ────────────────────────────────────────────────────
-- The core principle: never share owned data — replicate per-copy; only immutable facts are share-read. A register
-- entry is mutable AND disputable ("our maker may miss the date"), which is exactly the case the rule exists for.
-- `visibility` is recorded so a later phase can replicate a shared entry to the counterparty the way a chit is
-- copied. NOTHING IN PHASE 0 REPLICATES. The column exists so the fact is captured from the first row written.
--
-- Safe to re-run.

CREATE TABLE IF NOT EXISTS chit_line_raida (
  raida_id      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_id     uuid NOT NULL,
  chit_id       uuid NOT NULL,
  -- NULL = against the WHOLE chit (the credit, the Incoterm) rather than one line. See the note above.
  line_id       uuid,

  kind          text NOT NULL
                CHECK (kind IN ('risk', 'assumption', 'issue', 'dependency', 'action', 'decision')),
  -- What it says. In phase 0 that is all there is, deliberately.
  body          text NOT NULL CHECK (length(btrim(body)) > 0),

  /* ⚠️ THE CLOSING ROW. NULL on an entry; set on the row that closes one. Nothing is ever UPDATEd, so
     "what did we think on the 14th" stays answerable after it stops being true. */
  closes_id     uuid REFERENCES chit_line_raida(raida_id),

  /* Recorded from the first row, enforced by nothing yet — phase 0 replicates nothing. 'internal' is the safe
     default: an entry that says our own supplier may slip must never reach the counterparty by accident. */
  visibility    text NOT NULL DEFAULT 'internal' CHECK (visibility IN ('internal', 'shared')),

  /* Set when an issue was escalated through the EXISTING dispute path. A record that it happened, not a join. */
  dispute_id    uuid,

  /* ⚠️ SNAPSHOT, NOT A JOIN — the same rule chit_line_assignment states: a co-assist who later leaves must not
     blank out the history of who said what. */
  created_by_actor_id uuid,
  created_by_name     text,
  created_at    timestamptz NOT NULL DEFAULT now()
);

/* The register for one line, and for one chit — the two reads that exist. */
CREATE INDEX IF NOT EXISTS chit_line_raida_line ON chit_line_raida (entity_id, chit_id, line_id, created_at);
/* Open entries across every chit — "what is outstanding" — without scanning closed ones. */
CREATE INDEX IF NOT EXISTS chit_line_raida_open ON chit_line_raida (entity_id, kind) WHERE closes_id IS NULL;

ALTER TABLE chit_line_raida ENABLE ROW LEVEL SECURITY;
ALTER TABLE chit_line_raida FORCE  ROW LEVEL SECURITY;
DROP POLICY IF EXISTS chit_line_raida_isolation ON chit_line_raida;
/* ⚠️⚠️ NULLIF, NOT A BARE CAST — b181, and I reached for the old form out of b145 before the guard
   stopped me. current_setting(..., true) returns EMPTY STRING when nothing is set, and ''::uuid RAISES
   rather than returning NULL — so an unset context turns a clean "you see nothing" into an error from
   inside the policy, on every statement. NULLIF makes the miss behave like a miss. */
CREATE POLICY chit_line_raida_isolation ON chit_line_raida
  USING       (entity_id = NULLIF(current_setting('app.current_entity', true), '')::uuid)
  WITH CHECK  (entity_id = NULLIF(current_setting('app.current_entity', true), '')::uuid);
GRANT SELECT, INSERT, UPDATE, DELETE ON chit_line_raida TO cb_app;

/* ⚠️ ONE RESULT SET, no RAISE NOTICE — this is run by hand in the Supabase SQL editor. */
SELECT 'b182 applied' AS status,
       (SELECT count(*) FROM chit_line_raida) AS rows_now,
       (SELECT count(*) FROM pg_policies WHERE tablename = 'chit_line_raida') AS policies;
