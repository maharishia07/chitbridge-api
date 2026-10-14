-- b598_object_object_lots_report.sql — STK-FIX1b (2026-10-14, taken from closed api #218 b544): WHICH LOTS ARE NAMED "[OBJECT OBJECT]", AND WHAT BATCH EACH ONE REALLY WAS.
--   ⭐ READ-ONLY. Three SELECTs, no write of any kind. Safe to run as often as you like. The repair is b599 — run that only after reading this.
--
-- WHAT HAPPENED: the door (till.html Receive) writes a line's batch as item_data.lot = { batch, expiry }. lib/stock-from-chit.js passed that
--   OBJECT on as the lot; lib/lotfields.js lotKey did String(obj).toUpperCase(), so every batch of every receipt was keyed "[OBJECT OBJECT]"
--   and the expiry (read from item_data.expiry, where it never was) was lost. One nameless pool per product; FEFO had nothing to sort.
--   The code is fixed on the same branch (one reader, gs1.lotOf); this file finds what the old code left behind.
--
-- ⚠️ RUN IT **WITHOUT RLS** — the Supabase SQL editor, as `postgres`. Not `railway run`. stock_balance / stock_movement are entity-isolated
--   (b214: ENABLE + FORCE on app.current_entity). Under cb_app with no app.current_entity every policy is false and this answers ZERO ROWS,
--   which reads exactly like "nothing is wrong". An empty answer here means nothing until you know which role asked. [[feedback-state-rls-status]]
--
-- RLS: unchanged. GRANTs: unchanged. Nothing is created.

-- ── 1 · THE BALANCES. Expect one row per (shop, product) that ever received a batch through the door. qty is the sum of ALL its batches.
SELECT b.entity_id, b.item_id, b.location, b.lot, b.qty, b.value, b.avg_cost, b.unit, b.expires_at, b.moves, b.last_at
  FROM stock_balance b
 WHERE upper(btrim(b.lot)) = '[OBJECT OBJECT]'
 ORDER BY b.entity_id, b.item_id, b.location;

-- ── 2 · THE MOVEMENTS, each with the batch and expiry the chit line it came from actually carried.
--   `fix` says what b599 will do with the row:
--     ok          the chit line is found and its batch is readable (a string/number, 1–20 printable characters — gs1.lotOf's own rule) → re-keyed
--     doubled     a movement ALREADY exists under the right key for the same (ref, line_ref, reason) — the chit was re-posted after the code fix,
--                 so this shop holds that line's stock TWICE. b599 leaves it; it needs a hand (a count_adjust, or say which copy is real).
--     unresolved  no chit line found (ref/line_ref do not match any copy), or its batch is not readable → b599 leaves it, named here.
--                 ⚠️ a SALE (reason 'sale') that drew from the pool is always here: a bill line names no batch. After b599 the pool row reads
--                 negative by those sales until a count says which batch they left from.
WITH bad AS (
  SELECT m.* FROM stock_movement m WHERE upper(btrim(m.lot)) = '[OBJECT OBJECT]'
), src AS (
  SELECT m.movement_id, m.entity_id, m.item_id, m.location, m.reason, m.ref, m.line_ref, m.qty, m.unit, m.at,
         x.batch, x.expiry, x.chit_id
    FROM bad m
    LEFT JOIN LATERAL (
      SELECT h.chit_id,
             CASE WHEN jsonb_typeof(l.line#>'{item_data,lot,batch}') IN ('string', 'number')
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
SELECT s.entity_id, s.item_id, s.location, s.reason, s.ref, s.line_ref, s.qty, s.unit, s.at, s.chit_id,
       s.batch, s.expiry,
       CASE
         WHEN s.batch IS NULL THEN 'unresolved'
         WHEN EXISTS (SELECT 1 FROM stock_movement o
                       WHERE o.entity_id = s.entity_id AND o.ref = s.ref AND o.line_ref = s.line_ref AND o.reason = s.reason
                         AND COALESCE(o.lot, '') = upper(s.batch)) THEN 'doubled'
         ELSE 'ok'
       END AS fix,
       s.movement_id
  FROM src s
 ORDER BY fix, s.entity_id, s.item_id, s.at;

-- ── 3 · THE COUNT, by what b599 will do. Expect `ok` to be most of it. Anything `doubled` or `unresolved` needs a person before, or after, b599.
WITH bad AS (SELECT count(*) AS movements FROM stock_movement WHERE upper(btrim(lot)) = '[OBJECT OBJECT]'),
     bal AS (SELECT count(*) AS balances, COALESCE(sum(qty), 0) AS qty FROM stock_balance WHERE upper(btrim(lot)) = '[OBJECT OBJECT]')
SELECT bad.movements, bal.balances, bal.qty AS balance_qty FROM bad, bal;

-- AFTERWARDS: read section 2. If every row is `ok`, run b599. If any row is `doubled` or `unresolved`, b599 still repairs the `ok` rows and
--   leaves the others exactly as they are, re-listed by its own last step — nothing is guessed and nothing is deleted.
