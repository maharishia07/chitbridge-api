-- b599_object_object_lots_fix.sql — STK-FIX1b (2026-10-14, taken from closed api #218 b545): THE REPAIR — every "[OBJECT OBJECT]" movement goes back under the batch CODE its
--   chit line carried, with that line's expiry, and the balances are re-folded FROM THE LOG (b214: if the log and the cache disagree, the log wins).
--
-- ⚠️⚠️ DRAFT — NOT RUN · Athi runs it, AFTER reading b598's report (section 2: every row `ok`, or you know what the `doubled` / `unresolved` rows are).
-- ⚠️ RUN IT **WITHOUT RLS** — the Supabase SQL editor, as `postgres` (same reason as b598: the stock tables are entity-isolated, ENABLE + FORCE; cb_app
--   sees one shop, and cb_app has no UPDATE on stock_movement at all — b214 revoked it, on purpose).
--
-- ── WHAT THIS DOES, AND THE ONE RULE IT BENDS ─────────────────────────────────────────────────────────────────────────────────────────────────
--   stock_movement is APPEND-ONLY BY GRANT (b214): a movement is a claim about what physically happened, and nothing in the app may rewrite it.
--   This file UPDATES two columns of the bad rows — `lot` and `expires_at` — and nothing else: not qty, not rate, not value, not at. The claim
--   ("100 strips came in on GRN-9 line 1 at ₹10") stands; only WHICH BATCH they were is corrected, from the chit line that is the record of it.
--   That is why it is a one-off file run by a person as postgres, and not a code path.
--   · NEVER DELETES. The "[OBJECT OBJECT]" balance row is re-folded to what its REMAINING movements say (zero when all were re-keyed) and kept.
--   · NEVER GUESSES. A movement whose chit line cannot be found, or whose batch is not readable, is left as it is and listed at the end.
--     ⚠️ That includes a SALE that drew from the nameless pool: a bill line names no batch, so nobody can say which batch it left from. It stays
--     in the "[OBJECT OBJECT]" row, which then reads NEGATIVE by that much — true, and visible — until a count (count_adjust) says which batch.
--     Proven on a seed (2026-10-14, local Postgres 16): two batch lines re-keyed with their expiries; one junk-batch line and one pool sale left, named.
--   · NEVER DOUBLES. A movement already re-posted under the right key (the chit was sent again after the code fix) is left as it is and listed —
--     re-keying it would collide with uq_stock_movement_once and, worse, would be the SECOND copy of the same stock.
--   · IDEMPOTENT. A second run finds no `ok` rows and changes nothing; the proof at the end reads the same.
--   · ONE TRANSACTION. All or nothing.
--
-- RLS: unchanged (no table created, no policy touched). GRANTs: unchanged — cb_app still cannot UPDATE stock_movement after this.
-- Code: works before AND after — lib/stock-from-chit.js (T3-FIXES + STK-FIX1b) writes the right key from the day it deploys; this only repairs the past.

BEGIN;

-- ── 1 · RESOLVE: each bad movement → the batch and expiry of the chit line it came from (the same resolution b598 section 2 shows).
CREATE TEMP TABLE stk_fix ON COMMIT DROP AS
WITH bad AS (
  SELECT m.* FROM stock_movement m WHERE upper(btrim(m.lot)) = '[OBJECT OBJECT]'
), src AS (
  SELECT m.movement_id, m.entity_id, m.item_id, m.location, m.reason, m.ref, m.line_ref, x.batch, x.expiry
    FROM bad m
    LEFT JOIN LATERAL (
      SELECT CASE WHEN jsonb_typeof(l.line#>'{item_data,lot,batch}') IN ('string', 'number')
                   AND btrim(l.line#>>'{item_data,lot,batch}') ~ '^[ -~]{1,20}$'
                  THEN btrim(l.line#>>'{item_data,lot,batch}') END AS batch,
             CASE WHEN l.line#>>'{item_data,lot,expiry}' ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
                  THEN (l.line#>>'{item_data,lot,expiry}')::date END AS expiry
        FROM chit_header h
        JOIN chit_detail d ON d.chit_id = h.chit_id AND d.entity_id = h.entity_id
        CROSS JOIN LATERAL jsonb_array_elements(COALESCE(d.line_items, '[]'::jsonb)) WITH ORDINALITY AS l(line, n)
       WHERE h.entity_id = m.entity_id
         AND m.ref IN (h.business_json->>'client_ref', h.business_json->>'bill_no', h.business_json->>'doc_no', h.chit_id::text)
         AND m.line_ref IN (l.line->>'line_id', l.line#>>'{item_data,line_id}', l.n::text)
         AND COALESCE(l.line->>'item_id', l.line#>>'{item_data,item_id}') = m.item_id::text
       ORDER BY (l.line->>'line_id' = m.line_ref) DESC NULLS LAST
       LIMIT 1
    ) x ON true
)
SELECT s.*, upper(s.batch) AS lot_key
  FROM src s
 WHERE s.batch IS NOT NULL                                                          -- unresolved: left alone
   AND NOT EXISTS (SELECT 1 FROM stock_movement o                                   -- doubled: left alone
                    WHERE o.entity_id = s.entity_id AND o.ref = s.ref AND o.line_ref = s.line_ref AND o.reason = s.reason
                      AND COALESCE(o.lot, '') = upper(s.batch));

-- ── 2 · RE-KEY THE MOVEMENTS: lot = the batch code (lotfields.lotKey's own normalisation: trimmed, upper-cased), expires_at = the line's date.
UPDATE stock_movement m
   SET lot = f.lot_key,
       expires_at = COALESCE(m.expires_at, f.expiry)
  FROM stk_fix f
 WHERE m.movement_id = f.movement_id;

-- ── 3 · RE-FOLD THE BALANCES of every (shop, product, location) touched — one row per lot, computed from the log, exactly as stock-store.rebuild()
--   would (weighted average: value ÷ qty; the unit of the first movement; expires_at captured once and never changed — b215).
WITH touched AS (
  SELECT DISTINCT entity_id, item_id, location FROM stk_fix
), folded AS (
  SELECT m.entity_id, m.item_id, m.location, COALESCE(m.lot, '') AS lot, m.item_kind,
         sum(m.qty) AS qty, sum(COALESCE(m.value_delta, 0)) AS value, count(*) AS moves, max(m.at) AS last_at,
         min(m.expires_at) AS expires_at, (array_agg(m.unit ORDER BY m.at, m.movement_id))[1] AS unit
    FROM stock_movement m
    JOIN touched t ON t.entity_id = m.entity_id AND t.item_id = m.item_id AND t.location = m.location
   WHERE upper(btrim(COALESCE(m.lot, ''))) <> '[OBJECT OBJECT]'
   GROUP BY m.entity_id, m.item_id, m.location, COALESCE(m.lot, ''), m.item_kind
)
INSERT INTO stock_balance (entity_id, item_id, location, lot, item_kind, qty, value, avg_cost, unit, last_at, moves, expires_at, updated_at)
SELECT entity_id, item_id, location, lot, item_kind, qty, value,
       CASE WHEN qty > 0 THEN round(value / qty, 4) ELSE 0 END, unit, last_at, moves, expires_at, now()
  FROM folded
ON CONFLICT (entity_id, item_id, location, lot) DO UPDATE
   SET qty = EXCLUDED.qty, value = EXCLUDED.value, avg_cost = EXCLUDED.avg_cost, moves = EXCLUDED.moves,
       last_at = EXCLUDED.last_at, unit = COALESCE(stock_balance.unit, EXCLUDED.unit),
       expires_at = COALESCE(stock_balance.expires_at, EXCLUDED.expires_at), updated_at = now();

-- ── 4 · THE "[OBJECT OBJECT]" ROW of each touched group: what its REMAINING movements say (zero when every one was re-keyed). KEPT, never deleted —
--   a shop whose row still shows a quantity here has `doubled` / `unresolved` movements that b598 named, and a person decides those.
UPDATE stock_balance b
   SET qty = COALESCE(r.qty, 0), value = COALESCE(r.value, 0),
       avg_cost = CASE WHEN COALESCE(r.qty, 0) > 0 THEN round(COALESCE(r.value, 0) / r.qty, 4) ELSE 0 END,
       moves = COALESCE(r.moves, 0), updated_at = now()
  FROM (SELECT DISTINCT entity_id, item_id, location FROM stk_fix) t
  LEFT JOIN LATERAL (
    SELECT sum(m.qty) AS qty, sum(COALESCE(m.value_delta, 0)) AS value, count(*) AS moves
      FROM stock_movement m
     WHERE m.entity_id = t.entity_id AND m.item_id = t.item_id AND m.location = t.location
       AND upper(btrim(m.lot)) = '[OBJECT OBJECT]'
  ) r ON true
 WHERE b.entity_id = t.entity_id AND b.item_id = t.item_id AND b.location = t.location
   AND upper(btrim(b.lot)) = '[OBJECT OBJECT]';

COMMIT;

-- ── 5 · PROVE IT. Expect: (a) zero, or only the `doubled` / `unresolved` rows b598 named; (b) a balance per batch with its expiry.
SELECT count(*) AS still_object_object_movements, COALESCE(sum(qty), 0) AS their_qty
  FROM stock_movement WHERE upper(btrim(lot)) = '[OBJECT OBJECT]';

SELECT entity_id, item_id, location, lot, qty, value, avg_cost, unit, expires_at, moves
  FROM stock_balance
 WHERE (entity_id, item_id, location) IN (SELECT entity_id, item_id, location FROM stock_balance WHERE upper(btrim(lot)) = '[OBJECT OBJECT]')
 ORDER BY entity_id, item_id, location, expires_at NULLS LAST, lot;

-- AFTERWARDS: a pharmacy's or FMCG shop's balance reads one row per batch, soonest expiry first, and the next sale draws FEFO (stock-store.issue).
--   Re-run b598 any time: section 3 should read 0 · 0 · 0 once every row was `ok`.
