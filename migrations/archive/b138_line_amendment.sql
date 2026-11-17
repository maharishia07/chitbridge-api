-- ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════
-- b138 — AMENDMENT, REWORKED: a correction replaces the whole LINE, not a field.
-- ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════
--
-- ⚠️ THIS REPLACES b137, WHICH IS TWO HOURS OLD. b137 stored field-deltas (field / old_value / new_value). Athi
-- settled the model in discussion on 2026-08-11: *"just new line item, with all the amendments"* — the unit of
-- correction is the LINE. Carrying both shapes through the lifecycle is exactly the duplication I am supposed to
-- prevent, so the old one goes rather than being layered over.
--
-- ── ⚠️ WHY LINE-LEVEL BEATS FIELD-DELTA HERE ────────────────────────────────────────────────────────────────────
-- A field-delta answers "what changed". A replacement line answers "what is true now", which is the question every
-- total, view and sum actually asks. Computing the live set from deltas means replaying them in order for every
-- read; computing it from replacements means taking the latest. Repeated amendment stays trivial instead of
-- becoming a fold.
--
-- ── ⚠️ REMOVAL IS `line = NULL`, AND THAT IS THE WHOLE OF IT ────────────────────────────────────────────────────
-- Athi: *"old line deleted and new line is nothing... if the stock is not available the sku line will become
-- empty."*  A NULL replacement is a line that says "this is not happening". It is NOT quantity = 0, which is a line
-- that says "zero crates" and would leak a real zero into a total. One operation covers both amend and remove, so
-- there is no second code path to keep honest — the handover doc's separate VOID is not needed.
--
-- ── ⚠️ PER-COPY, WITH RLS (FORCE) ───────────────────────────────────────────────────────────────────────────────
-- A correction belongs to the entity that made it. On a co-held chit my reading must never appear on the
-- counterparty's copy as though they had agreed to it. Same isolation floor as every other entity-data table.

-- ── the guard ───────────────────────────────────────────────────────────────────────────────────────────────────
-- ⚠️ REFUSES TO RUN IF b137 EVER RECORDED ANYTHING. It was unreachable from the UI for most of its two-hour life
-- (the pen was gated on amendments_migrated, which was false until the API deployed), so it should be empty — but
-- "should be" is not a thing to drop a table on. If this raises, STOP and tell Athi; the rows need migrating by
-- hand, and that is a five-minute conversation rather than a guess.
DO $$
DECLARE n bigint;
BEGIN
  IF to_regclass('public.chit_amendment') IS NOT NULL THEN
    EXECUTE 'SELECT count(*) FROM chit_amendment' INTO n;
    IF n > 0 THEN
      RAISE EXCEPTION 'b138 ABORTED: chit_amendment holds % row(s). Do not drop it — hand these to Claude to migrate.', n;
    END IF;
    DROP TABLE chit_amendment;
    RAISE NOTICE 'b138: dropped b137 chit_amendment (was empty)';
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS chit_line_amendment (
  amendment_id  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  chit_id       uuid NOT NULL,
  entity_id     uuid NOT NULL,

  -- WHICH line of the ORIGINAL reading this corrects. The original is never renumbered, so this stays valid
  -- however many times the line is amended.
  line_index    integer NOT NULL,

  -- Position in this line's chain. 1 = first correction. The LIVE version is simply the highest seq.
  -- ⚠️ A chain, not a single row: Athi's own messages contain "Sorry make that 8 kg. And 2 crate tomato, no wait
  --    3 crate" — people correct their corrections, and every step has to stay readable.
  seq           integer NOT NULL,

  -- ⭐ THE REPLACEMENT LINE, whole. Same shape as chit_detail.line_items:
  --      { particulars, quantity, unit, unit_size, price, comment }
  -- ⚠️ NULL MEANS REMOVED — visible on the chit as evidence, counted in nothing.
  line          jsonb,

  -- ⚠️ WHY, AND IT IS NOT DECORATION. Two corrections produce an identical empty line and mean OPPOSITE things:
  --      misread_by_ai      → the customer never asked for this; our record was wrong
  --      stock_unavailable  → the customer DID ask, and we are declining; he will turn up expecting it
  -- The first is a correction, the second is a business event someone still owes a conversation about. Counting
  -- misread_by_ai over time is also the only honest measure of whether the reading is improving.
  reason_code   text NOT NULL DEFAULT 'other'
                CHECK (reason_code IN ('misread_by_ai','customer_clarified','rate_agreed','stock_unavailable','other')),
  reason        text,

  actor_id      uuid,
  actor_name    text,
  created_at    timestamptz NOT NULL DEFAULT now(),

  -- One row per step per line. Makes the chain append-only by construction rather than by convention.
  UNIQUE (entity_id, chit_id, line_index, seq)
);

CREATE INDEX IF NOT EXISTS chit_line_amendment_chit   ON chit_line_amendment (entity_id, chit_id, line_index, seq);
CREATE INDEX IF NOT EXISTS chit_line_amendment_reason ON chit_line_amendment (entity_id, reason_code, created_at);

ALTER TABLE chit_line_amendment ENABLE ROW LEVEL SECURITY;
ALTER TABLE chit_line_amendment FORCE  ROW LEVEL SECURITY;

DROP POLICY IF EXISTS chit_line_amendment_isolation ON chit_line_amendment;
CREATE POLICY chit_line_amendment_isolation ON chit_line_amendment
  USING       (entity_id = current_setting('app.current_entity', true)::uuid)
  WITH CHECK  (entity_id = current_setting('app.current_entity', true)::uuid);

GRANT SELECT, INSERT, UPDATE, DELETE ON chit_line_amendment TO cb_app;

COMMENT ON TABLE chit_line_amendment IS
  'b138 — line-level corrections. Each row is a FULL replacement line; NULL line = removed (visible, counted nowhere). Latest seq per line_index is live. Replaces b137 field-deltas. Per-copy, WITH RLS (FORCE).';

DO $$
BEGIN
  RAISE NOTICE 'b138: chit_line_amendment created WITH RLS (FORCE). Live set = original - removed + latest replacement.';
END $$;
