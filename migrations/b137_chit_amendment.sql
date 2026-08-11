-- ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════
-- b137 — AMENDMENTS. A correction is recorded ALONGSIDE the original, never over it.
-- ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════
--
-- Athi, 2026-08-11: *"this proves that we cannot be correct in everything, but can be learnt... we have to provide
-- an edit option while performing the action at the task level. what the original content is and what it has been
-- amended to, so we provide a chance to amend it correctly."*
--
-- ── ⚠️ WHY A TABLE AND NOT AN UPDATE TO line_items ──────────────────────────────────────────────────────────────
-- A chit is a CO-HELD, IMMUTABLE record — the API already refuses to purge a sent one for exactly this reason.
-- Editing the lines in place would break two things at once: the counterparty's copy would silently stop matching
-- ours, and the customer's own words would be overwritten by our correction of them.
--
-- In a dispute six weeks later there are THREE different facts and you need all of them:
--     what the customer wrote        (capture.raw_text — already kept, and attached to the chit)
--     what the reader made of it     (chit_detail.line_items — the original reading, untouched by this)
--     what a human corrected it to   (this table)
-- An in-place edit leaves only the third, and it would look authoritative while being unverifiable.
--
-- ── ⚠️ PER-COPY, WITH RLS ───────────────────────────────────────────────────────────────────────────────────────
-- An amendment belongs to the entity that made it. If a chit is ever co-held, my correction is MY reading of it and
-- must not appear on the counterparty's copy as though they had agreed to it. Same isolation floor as every other
-- entity-data table (FORCE, so the table owner is bound too).
--
-- Safe to re-run; nothing existing is altered.

CREATE TABLE IF NOT EXISTS chit_amendment (
  amendment_id  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  chit_id       uuid NOT NULL,
  entity_id     uuid NOT NULL,
  -- WHICH line. NULL = the chit as a whole (delivery address, notes, a date).
  line_index    integer,
  field         text NOT NULL,                -- particulars | quantity | unit | unit_size | price | comment | …
  old_value     text,                         -- what it said before. NULL is meaningful: the field was absent.
  new_value     text,                         -- what it says now. NULL = the amender removed it.
  -- WHO and WHY. A correction with no author is not evidence, and "why" is what turns a change into a reason.
  actor_id      uuid,
  actor_name    text,
  reason        text,
  -- ⚠️ WAS THIS A READING ERROR OR A NAMING FACT? They teach different things:
  --   'reading'  the structure was misread (a size taken as a quantity) -> that is a PROMPT fix, needs a human
  --   'naming'   this word means that catalogue item ("thakkali" -> Tomato) -> that is DATA, and can be learned
  -- Counting the first kind is the only honest measure of whether the reader is getting better.
  kind          text NOT NULL DEFAULT 'reading' CHECK (kind IN ('reading', 'naming', 'other')),
  -- Set when a 'naming' amendment was accepted into the catalogue as a synonym, so the loop is auditable and a
  -- correction cannot be silently counted twice.
  learned_at    timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS chit_amendment_chit  ON chit_amendment (entity_id, chit_id, line_index);
CREATE INDEX IF NOT EXISTS chit_amendment_learn ON chit_amendment (entity_id, kind, learned_at);

ALTER TABLE chit_amendment ENABLE ROW LEVEL SECURITY;
ALTER TABLE chit_amendment FORCE  ROW LEVEL SECURITY;

DROP POLICY IF EXISTS chit_amendment_isolation ON chit_amendment;
CREATE POLICY chit_amendment_isolation ON chit_amendment
  USING       (entity_id = current_setting('app.current_entity', true)::uuid)
  WITH CHECK  (entity_id = current_setting('app.current_entity', true)::uuid);

GRANT SELECT, INSERT, UPDATE, DELETE ON chit_amendment TO cb_app;

COMMENT ON TABLE chit_amendment IS
  'b137 — corrections recorded ALONGSIDE the original reading, never over it. The chit''s line_items stay as read; the UI shows the old value struck through and the new one beside it. Per-copy, WITH RLS (FORCE).';

DO $$
BEGIN
  RAISE NOTICE 'b137: chit_amendment created WITH RLS (FORCE) — line_items are never mutated; corrections live here';
END $$;
