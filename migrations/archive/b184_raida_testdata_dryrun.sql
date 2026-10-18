-- ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════
-- b184 (DRY RUN) — remove the three register rows Claude wrote while verifying the roll-up. Reads only.
-- ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════
--
-- Athi, 2026-08-30: *"clear the test entries"* — the second round, after b183. These were written to prove the
-- Insight → Register report: one open risk, and one action closed so the report had both bands to render.
--
-- ⚠️ SAME REASON THIS IS SQL AND NOT A BUTTON. `chit_line_raida` is append-only by design — closed by adding a
-- row, never edited, never deleted. There is no delete route and there should not be one.
--
-- ⚠️ TWO ENTRIES, THREE ROWS. The action was closed, so it has a closing row pointing back at it. `closes_id` is
-- a foreign key to this same table, so entries and their closers must go in ONE statement or the delete violates
-- the constraint. The apply script matches on `raida_id IN (...) OR closes_id IN (...)` for exactly that.
--
-- Run this first. One result set, changes nothing.

WITH targets AS (
  SELECT unnest(ARRAY[
    '62623abd-0aa0-4c2d-bfd1-12e54d0f9d9a',   -- risk   · "Compressor may be weak…"        open
    'ed1f53e1-fbb6-44cd-9f4e-1d78b0775c93'    -- action · "Order the o-ring before Thursday." closed
  ]::uuid[]) AS raida_id
)
SELECT r.raida_id,
       CASE WHEN r.closes_id IS NULL THEN 'entry' ELSE 'closing row' END AS row_type,
       r.kind,
       left(r.body, 60) AS body,
       r.created_by_name,
       r.created_at
  FROM chit_line_raida r
 WHERE r.raida_id IN (SELECT raida_id FROM targets)
    OR r.closes_id IN (SELECT raida_id FROM targets)
 ORDER BY r.created_at;

-- EXPECTED: 3 rows — 2 entries and 1 closing row, all 'Chola Auto Care', all on the AC gas line of chit 86cb4e74.
-- ⚠️ If any of it looks like yours, STOP and say so rather than running the apply.
