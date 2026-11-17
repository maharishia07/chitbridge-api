-- ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════
-- b183 (DRY RUN) — remove the five register rows Claude wrote while verifying b182. Reads only, changes nothing.
-- ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════
--
-- Athi, 2026-08-30: *"yes, clear the test entries"*.
--
-- ── ⚠️ WHY THIS IS SQL AND NOT A BUTTON ─────────────────────────────────────────────────────────────────────────
-- `chit_line_raida` is APPEND-ONLY by design — an entry is closed by adding a row, never edited, never deleted.
-- That is the property the whole thing rests on, so there is deliberately no delete route and there should not be
-- one. Removing verification data is therefore a one-off correction made outside the product, exactly like any
-- other, and it is Athi's to run.
--
-- ── ⚠️ BY ID, NOT BY A PREDICATE ────────────────────────────────────────────────────────────────────────────────
-- A tempting shortcut is "everything on this line created today". That would also take anything Athi recorded on
-- the same line while looking at the screen. These five rows are named individually: three entries and the two
-- rows that close two of them.
--
-- ⚠️ THE CLOSING ROWS MATTER. `closes_id` is a foreign key back to this same table, so deleting an entry while the
-- row that closes it survives would violate the constraint. Both the entries and their closers go in ONE
-- statement, which is why the apply script deletes on `raida_id IN (...) OR closes_id IN (...)`.
--
-- Run this first. It returns one result set and touches nothing.

WITH targets AS (
  SELECT unnest(ARRAY[
    '69a89b6d-3700-4b79-aba4-4c9ec1069860',   -- assumption · "Gas top-up assumed enough…"      (closed)
    'c4c7104f-a504-48a4-a9ea-cf0ac1914aaa',   -- dependency · "Customer to confirm…"  order-level, open
    '91e55f26-6ba3-465d-92ed-c6aa475ca884'    -- risk       · "Gas may leak again…"             (closed)
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

-- EXPECTED: 5 rows — 3 entries and 2 closing rows, all created_by_name 'Chola Auto Care' on 2026-08-30.
-- ⚠️ If you see anything you recognise as yours, STOP and tell Claude rather than running the apply.
