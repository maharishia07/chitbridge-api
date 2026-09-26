-- b263: ONE BILL NUMBER = ONE CHIT. The index behind the counter's idempotency.
--
-- ✅ CONFIRMED APPLIED — checked live 2026-09-26 (read-only: pg_indexes + a fresh duplicate-scan, no write run
-- by the assistant, per the standing rule that DDL is Athi's to execute). ux_chit_client_ref_per_entity exists
-- on chit_header exactly as step 2 below defines it, and a live re-run of step 1's duplicate query returns
-- ZERO rows. Left in the tree as the record of what was done and why — a migration whose header still says
-- "DRAFT — NOT RUN" once it has quietly been run is exactly the kind of stale doc [[feedback-document-status]]
-- warns costs more than a missing one. Nothing below needs running again; safe to re-run regardless (see step
-- 2's own IF NOT EXISTS).
--
-- ── RUN AS `postgres` IN THE SUPABASE SQL EDITOR, NOT `railway run` ─────────────────────────────────────────
-- ⚠️⚠️ Missing from the first cut of this file, and it should not have been: step 1's duplicate-scan reads
-- chit_header ACROSS EVERY ENTITY (no entity_id filter — that is its whole job, finding a collision between
-- two shops' data would need exactly this). Run through anything RLS-scoped to one tenant and it silently
-- answers a SUBSET — not an error, just an incomplete "no duplicates" that is not actually true. `railway run`
-- connects as `cb_app` and cannot do DDL at all regardless (see below), so it was never really in play for
-- step 2 — but step 1 alone, run the wrong way, would have been the exact quiet failure mode b263b's own
-- header warns about for its step 1: an empty answer that means nothing until you know which role asked.
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
-- counter open on two devices — which is the shape of the series-prefix fault that already cost a day.
--
-- ⚠️ A bill number is unique to the SHOP that issued it, never to the platform — hence (entity_id, client_ref),
-- and never client_ref alone. Two shops both numbering C1/26-27/0001 is normal and correct.
--
-- ── ⚠️⚠️ WHY THERE IS NO `CONCURRENTLY` HERE, AND WHY THE FIRST DRAFT FAILED ──────────────────────────────────
-- The first draft said CREATE UNIQUE INDEX CONCURRENTLY and Athi got:
--     ERROR: 25001: CREATE INDEX CONCURRENTLY cannot run inside a transaction block
-- That is not something running the statement on its own can fix. The Supabase SQL editor wraps what it sends in
-- a transaction, and the connection behind it is the transaction pooler (:6543) — CONCURRENTLY needs its own
-- session outside any transaction and cannot have one through either. The other route we have, `railway run`,
-- connects as `cb_app`, which is NOSUPERUSER and owns nothing, so it cannot do DDL at all. The editor is the only
-- DDL path we have, so the index is built the ordinary way.
--
-- ⭐ WHAT THE ORDINARY WAY COSTS: a plain CREATE INDEX takes an ACCESS EXCLUSIVE lock on chit_header until the
-- build finishes — reads and writes on that table wait, which means bills wait. Step 1 prints the row count so
-- the size of that pause is known before it is taken, not guessed at. At our size it is milliseconds; if
-- chit_header is ever large enough for it to matter, the answer is a maintenance window or a direct (non-pooled)
-- session, not a different statement.


-- ═══ 1 · LOOK BEFORE YOU BUILD ═══════════════════════════════════════════════════════════════════════════════
-- Run this whole step first and read both answers.
--
--   · "rows" says how long step 2 will hold its lock. Thousands → milliseconds. Millions → wait for a quiet hour.
--   · the second result must be EMPTY. Any row is a bill number recorded more than once, and step 2 will refuse
--     to build while one exists — that refusal is the index doing its job, not a failure. Step 3 then lists what
--     each copy carries so the decision can be made with the facts.

SELECT count(*) AS rows,
       count(*) FILTER (WHERE business_json->>'client_ref' IS NOT NULL) AS with_a_bill_number
  FROM chit_header;

SELECT entity_id,
       business_json->>'client_ref'           AS bill_no,
       count(*)                               AS copies,
       array_agg(chit_id ORDER BY created_at) AS chits,
       min(created_at)                        AS first_at,
       max(created_at)                        AS last_at
  FROM chit_header
 WHERE business_json->>'client_ref' IS NOT NULL
 GROUP BY 1, 2
HAVING count(*) > 1
 ORDER BY copies DESC, last_at DESC;


-- ═══ 2 · THE INDEX ═══════════════════════════════════════════════════════════════════════════════════════════
-- Safe to re-run: IF NOT EXISTS makes a second run a no-op.
-- ⚠️ If this errors with "could not create unique index … contains duplicated values", step 1's second query has
-- rows. Go to step 3; do not force it.

CREATE UNIQUE INDEX IF NOT EXISTS ux_chit_client_ref_per_entity
    ON chit_header (entity_id, (business_json->>'client_ref'))
 WHERE business_json->>'client_ref' IS NOT NULL;

-- proof, for the person who ran it: this should print one row
SELECT indexname, indexdef FROM pg_indexes
 WHERE tablename = 'chit_header' AND indexname = 'ux_chit_client_ref_per_entity';


-- ═══ 3 · ONLY IF STEP 1 FOUND DUPLICATES ═════════════════════════════════════════════════════════════════════
-- ⚠️⚠️ NOT A CLEANUP SCRIPT, AND DELIBERATELY NOT WRITTEN AS ONE. A duplicate here is a second voucher for a real
-- sale; which copy the books, the stock movements and any credit note already point at is a question about that
-- shop's accounts, not a row to drop. This lists what each copy carries so the decision is an informed one.
--
-- The ones the R2 test made are in throwaway test entities (named "offline40…") and can go; anything in a real
-- shop wants reading first.

-- WITH dupes AS (
--   SELECT entity_id, business_json->>'client_ref' AS bill_no
--     FROM chit_header WHERE business_json->>'client_ref' IS NOT NULL
--    GROUP BY 1,2 HAVING count(*) > 1
-- )
-- SELECT h.entity_id, h.business_json->>'client_ref' AS bill_no, h.chit_id, h.created_at,
--        h.purpose, h.summary_json->'money'->>'total' AS total,
--        (SELECT count(*) FROM chit_detail   d WHERE d.chit_id = h.chit_id) AS detail_rows,
--        (SELECT count(*) FROM stock_movement m WHERE m.chit_id = h.chit_id) AS stock_rows
--   FROM chit_header h JOIN dupes u
--     ON u.entity_id = h.entity_id AND u.bill_no = h.business_json->>'client_ref'
--  ORDER BY h.entity_id, bill_no, h.created_at;


-- ── AFTER THIS RUNS — WHICH IT HAS, SO THIS IS NOW UNBLOCKED, NOT DONE ──────────────────────────────────────
-- ⚠️ NOT YET LANDED. The index existing is what makes this safe to write; it is not the same thing as having
-- written it. routes/chits.js's INSERT is still the plain check-then-act it always was — a genuine race today
-- would 500, not silently duplicate (the index catches it), but it would 500 rather than quietly returning the
-- winner's chit the way a replay already expects. That code change is its own, separate, real edit to the
-- send path — worth doing, worth its own explicit go-ahead given what it touches, not bundled into this file.
-- routes/chits.js should carry its INSERT as ON CONFLICT DO NOTHING followed by a re-SELECT, so the loser of a
-- race returns the winner's chit instead of a 500 — which is already what the counter expects from a replay, and
-- what the existing SELECT-first path returns today. Until that lands, a racing duplicate becomes a clean 500,
-- the bill stays queued and is retried, and the retry finds the winner. Noisy, never a second voucher. That is
-- the right way round, and it is why this index is worth running before the route change rather than after.
