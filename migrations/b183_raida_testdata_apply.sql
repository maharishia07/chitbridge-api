-- ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════
-- b183 (APPLY) — remove the five register rows Claude wrote while verifying b182.
-- ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════
--
-- ⚠️ RUN b183_raida_testdata_dryrun.sql FIRST and read what it lists. This one deletes.
--
-- Athi, 2026-08-30: *"yes, clear the test entries"*. Written by Claude on the AC gas line of chit 86cb4e74 while
-- proving b182 end to end — two through the API, one through the screen, two of them closed.
--
-- ── ⚠️ THIS IS A CORRECTION, NOT A FEATURE ──────────────────────────────────────────────────────────────────────
-- `chit_line_raida` is append-only on purpose: an entry is closed by adding a row, never edited and never deleted.
-- There is no delete route and there should not be one. Cleaning up verification data is a one-off made outside
-- the product — which is the honest cost of having verified against the live database.
--
-- ── ⚠️ ONE STATEMENT, BECAUSE closes_id IS A FOREIGN KEY BACK TO THIS TABLE ──────────────────────────────────────
-- Deleting an entry while the row that closes it survives would violate the constraint. Entries and their closers
-- go together in a single DELETE, so no surviving row can reference a deleted one.
--
-- Safe to re-run: a second run deletes nothing and reports 0.

WITH targets AS (
  SELECT unnest(ARRAY[
    '69a89b6d-3700-4b79-aba4-4c9ec1069860',   -- assumption · "Gas top-up assumed enough…"      (closed)
    'c4c7104f-a504-48a4-a9ea-cf0ac1914aaa',   -- dependency · "Customer to confirm…"  order-level, open
    '91e55f26-6ba3-465d-92ed-c6aa475ca884'    -- risk       · "Gas may leak again…"             (closed)
  ]::uuid[]) AS raida_id
),
gone AS (
  DELETE FROM chit_line_raida r
   WHERE r.raida_id IN (SELECT raida_id FROM targets)
      OR r.closes_id IN (SELECT raida_id FROM targets)
  RETURNING r.raida_id, r.closes_id
)
SELECT 'b183 applied' AS status,
       (SELECT count(*) FROM gone)                             AS rows_deleted,
       (SELECT count(*) FROM gone WHERE closes_id IS NULL)      AS entries_deleted,
       (SELECT count(*) FROM gone WHERE closes_id IS NOT NULL)  AS closing_rows_deleted,
       (SELECT count(*) FROM chit_line_raida)                   AS register_rows_remaining;

-- EXPECTED on the first run: rows_deleted 5 · entries 3 · closing rows 2 · remaining 0.
-- ⚠️ `register_rows_remaining` counts the WHOLE table. If it is not 0, something else has been recorded since —
--    which is fine, but tell Claude so the number is explained rather than assumed.
