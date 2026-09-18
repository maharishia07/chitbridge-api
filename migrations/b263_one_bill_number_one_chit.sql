-- b263: ONE BILL NUMBER = ONE CHIT. The index behind the counter's idempotency.
--
-- ⚠️⚠️ DRAFT — NOT RUN. For Athi to review and run himself (standing rule: DDL is his to execute, never the
-- assistant's). Run the CHECK in step 1 first — step 2 will refuse to build while duplicates exist, and that
-- refusal is the point, not a failure.
--
-- ── WHY ──────────────────────────────────────────────────────────────────────────────────────────────────────
-- Found 2026-09-18 by running the design package's own R2 test: forty bills rung with the line down, then
-- reconnect. TWENTY-NINE of the forty came back recorded TWICE, under two different chit_id. Two vouchers for one
-- sale in a shop's books, from the single scenario the offline queue exists to survive.
--
-- The counter's half is fixed and shipped ([TILL-48]: its drain watchdog was timing the RUN instead of the
-- request, so a legitimately long queue looked hung and a second drain started over the top of the first).
--
-- The server's half is here, and it is not fixable from the counter. routes/chits.js dedupes like this:
--
--     SELECT chit_id FROM chit_header WHERE entity_id = $1 AND business_json->>'client_ref' = $2   -- then INSERT
--
-- A check-then-act with no unique index behind it. Two requests that arrive together both find nothing and both
-- write. One counter can no longer send the same row twice; TWO counters on one shop still can, and so can one
-- counter open on two devices — which is exactly the shape of [[project-till-series-prefix]], the fault that
-- already cost a day's confusion.
--
-- ⚠️ A bill number is unique to the SHOP that issued it, never to the platform — hence (entity_id, client_ref),
-- and never client_ref alone. Two shops both numbering C1/26-27/0001 is normal and correct.
--
-- ── AFTER THIS RUNS ──────────────────────────────────────────────────────────────────────────────────────────
-- routes/chits.js should carry the INSERT as ON CONFLICT DO NOTHING followed by a re-SELECT, so the loser of a
-- race returns the winner's chit instead of a 500 — which is already what the counter expects from a replay, and
-- what the existing SELECT-first path returns today. Until that lands, a racing duplicate becomes a clean 500 and
-- the bill stays queued and is retried: noisy, but never a second voucher. That is the right way round.


-- ═══ 1 · LOOK BEFORE YOU BUILD ═══════════════════════════════════════════════════════════════════════════════
-- Run this ALONE first. Empty result → go to step 2. Any rows → step 3 names them, and they are real duplicate
-- vouchers that want deciding on, not deleting on sight.

SELECT entity_id,
       business_json->>'client_ref'        AS bill_no,
       count(*)                            AS copies,
       array_agg(chit_id ORDER BY created_at) AS chits,
       min(created_at)                     AS first_at,
       max(created_at)                     AS last_at
  FROM chit_header
 WHERE business_json->>'client_ref' IS NOT NULL
 GROUP BY 1, 2
HAVING count(*) > 1
 ORDER BY copies DESC, last_at DESC;


-- ═══ 2 · THE INDEX ═══════════════════════════════════════════════════════════════════════════════════════════
-- ⚠️ CONCURRENTLY cannot run inside a transaction block. In the Supabase SQL editor run this statement on its
-- own, not selected together with anything above or below it.
--
-- ⚠️ If it fails with "could not create unique index", duplicates exist: the index is left INVALID and must be
-- dropped before retrying —  DROP INDEX ux_chit_client_ref_per_entity;  — then do step 3 and come back.

CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS ux_chit_client_ref_per_entity
    ON chit_header (entity_id, (business_json->>'client_ref'))
 WHERE business_json->>'client_ref' IS NOT NULL;


-- ═══ 3 · ONLY IF STEP 1 FOUND ANY ════════════════════════════════════════════════════════════════════════════
-- ⚠️⚠️ NOT A CLEANUP SCRIPT, AND DELIBERATELY NOT WRITTEN AS ONE. A duplicate here is a second voucher for a real
-- sale; which copy is the one the books, the stock movements and any credit note already point at is a question
-- about that shop's accounts, not a row to drop. This lists what each copy carries so the decision is informed.
--
-- The ones my test made are in a throwaway test entity ("offline40…") and can go; anything in a real shop wants
-- Athi's eye first.

-- WITH dupes AS (
--   SELECT entity_id, business_json->>'client_ref' AS bill_no
--     FROM chit_header WHERE business_json->>'client_ref' IS NOT NULL
--    GROUP BY 1,2 HAVING count(*) > 1
-- )
-- SELECT h.entity_id, h.business_json->>'client_ref' AS bill_no, h.chit_id, h.created_at,
--        h.purpose, h.summary_json->'money'->>'total' AS total,
--        (SELECT count(*) FROM chit_detail d  WHERE d.chit_id = h.chit_id)  AS detail_rows,
--        (SELECT count(*) FROM stock_movement m WHERE m.chit_id = h.chit_id) AS stock_rows
--   FROM chit_header h JOIN dupes u
--     ON u.entity_id = h.entity_id AND u.bill_no = h.business_json->>'client_ref'
--  ORDER BY h.entity_id, bill_no, h.created_at;
