-- ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════
-- b148 — `ambiguity_resolved` becomes a legal amendment reason.
-- ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════
--
-- ⚠️ WHY THIS EXISTS: I ADDED THE VALUE IN JAVASCRIPT AND NOT IN THE DATABASE (13 Aug), and never ran it.
--
-- lib/amend.js keeps a REASONS whitelist; b138 keeps a CHECK constraint. They are the same rule, written twice.
-- Adding `ambiguity_resolved` to one and not the other meant every correction made through the new picker was
-- built correctly, sent correctly, and rejected by the constraint — surfacing as a bare 500 with "Something went
-- wrong". Athi hit it as "the save does nothing", three separate times, with no way to see why.
--
-- Proven by bisecting the amend body against the live API:
--     reason_code misread_by_ai        -> 200
--     reason_code ambiguity_resolved   -> 500
--     the same body + ref              -> 200      (the reference work was never the problem)
--     the same body + lot              -> 200      (nor lots)
--
-- ── ⭐ WHY THE VALUE IS WORTH THE MIGRATION rather than reusing `other` ──────────────────────────────────────────
-- `misread_by_ai` is the counter that tells us whether the reading is improving. Filing an ambiguity resolution
-- under it would blame the reader for the CUSTOMER's ambiguity and make the machine look worse the more carefully
-- it refused. `other` loses the fact entirely. This says: the reader was right to refuse — the sender's words
-- genuinely answered to more than one catalogue item — and a named person chose between them.
--
-- Safe to re-run.

ALTER TABLE chit_line_amendment DROP CONSTRAINT IF EXISTS chit_line_amendment_reason_code_check;

ALTER TABLE chit_line_amendment
  ADD CONSTRAINT chit_line_amendment_reason_code_check
  CHECK (reason_code IN ('misread_by_ai', 'customer_clarified', 'rate_agreed', 'stock_unavailable',
                         'ambiguity_resolved', 'other'));

DO $$
DECLARE n bigint;
BEGIN
  SELECT count(*) INTO n FROM chit_line_amendment;
  RAISE NOTICE 'b148: reason_code now accepts ambiguity_resolved. % existing amendment(s) untouched.', n;
END $$;
