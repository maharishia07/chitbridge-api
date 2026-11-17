-- ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════
-- b153 — "I finished my bit." The PRIVATE work state of a line, separate from whether the goods went out.
-- ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════
--
-- Athi, 2026-08-14: *"he can set the status to close, in the sense that this subtask is completed — so set the
-- status as complete so others should not do that."*
--
-- ── ⭐ WHY THIS IS STORED WHEN LINE COMPLETION IS NOT ───────────────────────────────────────────────────────────
-- I argued two hours ago that a line status must never be stored, because `complete` is summed from delivery
-- events every time it is asked and a stored copy would drift the moment someone records a correction. That is
-- still true — of DELIVERY. This is a different fact:
--
--     delivery complete   SHARED    derived from events        "the goods went out"
--     work state          PRIVATE   declared by a person       "I finished my bit"
--
-- They can honestly disagree, and both being visible is the point: Murugan finishes picking before the lorry
-- leaves, so his task is done while the line still owes. A single merged status would have to pick one of those
-- and would silently lie about the other. And nothing derives "Murugan says he is done" — it is a declaration, so
-- it must be recorded.
--
-- ⚠️ PRIVATE, LIKE EVERY OTHER COLUMN ON THIS TABLE. It rides on chit_line_assignment, which b143 built as the
-- private half of division of labour — the counterparty must never learn who is behind on what. It is therefore
-- WITH RLS by inheritance and is never joined into a co-held read. Nothing about the goods changes here.
--
-- ── APPEND-ONLY, BECAUSE THE TABLE ALREADY IS ──────────────────────────────────────────────────────────────────
-- assign() inserts a new row with seq+1 and current() reads DISTINCT ON … ORDER BY seq DESC, keeping the earlier
-- rows as history. So "mark done" is not an UPDATE — it is another row carrying the same assignee forward with
-- state='done'. Who marked it, and when, comes free, and un-marking is another row rather than an erasure. Making
-- this column mutable would have been the one place in the file where history could be quietly rewritten.
--
-- Safe to re-run. Every existing row becomes 'open', which is what it already meant.

ALTER TABLE chit_line_assignment ADD COLUMN IF NOT EXISTS state text NOT NULL DEFAULT 'open';

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chit_line_assignment_state_chk') THEN
    /* ⚠️ TWO VALUES. 'blocked' and 'in progress' were both considered and both refused for now: neither changes
       any behaviour, and a status nobody acts on is a field people stop updating — after which it is worse than
       absent, because it looks authoritative and is stale. Refusing a line already has a real path (amend it away
       with a reason). Add a third value when something genuinely branches on it. */
    ALTER TABLE chit_line_assignment
      ADD CONSTRAINT chit_line_assignment_state_chk CHECK (state IN ('open', 'done'));
  END IF;
END $$;

/* The worklist reads the latest row per line and filters on state, so the index that already serves
   DISTINCT ON (chit_id, line_id) ORDER BY seq DESC is what matters; state is a filter on top of it, never a
   leading key. Checked before adding anything: no new index earns its write cost here. */

-- ── ⚠️ AND A REAL DEFECT IN b152'S HELPER, FIXED BEFORE ANYTHING USES IT ───────────────────────────────────────
--
-- `chit_line_delivered_qty()` shipped in b152 with NO entity filter. It is SECURITY DEFINER, so it bypasses RLS
-- by design — and then summed every participant's copy of every claim. On a two-party chit it returned DOUBLE
-- what had gone out, and it counted the COUNTERPARTY's claims as though they were mine.
--
-- It was harmless only by luck: nothing called it (lib/amend.js carried its own inline copy of the same rule).
-- That luck is ending here, because the worklist is about to need the same figure, and three hand-written copies
-- of one rule is how the three of them drift apart. So this becomes the ONE definition and both callers use it.
--
-- ⚠️ "DELIVERED" MEANS **MY OWN CLAIM**, matching lib/deliverline.js's `e.mine` exactly. Letting the counterparty's
-- claim raise my delivered figure would hand them authority over my own record — quiet authority across the
-- boundary is the one thing CB must never allow. Theirs is shown BESIDE mine, never merged into it.
CREATE OR REPLACE FUNCTION chit_line_delivered_qty(p_chit_id uuid, p_line_id uuid)
RETURNS numeric
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT COALESCE(SUM(d.quantity), 0)
    FROM chit_line_delivery d
    JOIN chit_line l
      ON l.entity_id = d.entity_id AND l.chit_id = d.chit_id AND l.line_id = d.line_id
   WHERE d.chit_id = p_chit_id
     AND d.line_id = p_line_id
     -- the caller's OWN copy, and the caller's OWN claim
     AND d.entity_id            = NULLIF(current_setting('app.current_entity', true), '')::uuid
     AND d.recorded_by_entity_id = NULLIF(current_setting('app.current_entity', true), '')::uuid
     -- 'add' accrues, it never draws down; and 12 pieces are not 12 kg
     AND COALESCE(d.kind, 'deliver') = 'deliver'
     AND COALESCE(NULLIF(btrim(lower(d.unit)), ''), btrim(lower(COALESCE(l.unit, ''))))
       = btrim(lower(COALESCE(l.unit, '')));
$$;

GRANT EXECUTE ON FUNCTION chit_line_delivered_qty(uuid, uuid) TO cb_app;

DO $$
DECLARE n bigint;
BEGIN
  SELECT count(*) INTO n FROM chit_line_assignment;
  RAISE NOTICE 'b153: chit_line_delivered_qty() now scopes to the caller''s own copy and own claim (b152 summed every party''s).';
  RAISE NOTICE 'b153: % existing assignment row(s) are state=open — unchanged in meaning.', n;
  RAISE NOTICE 'b153: marking a subtask done is a NEW seq row, so who marked it and when is kept.';
END $$;
