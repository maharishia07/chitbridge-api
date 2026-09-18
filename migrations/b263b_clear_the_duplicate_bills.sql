-- b263b: the duplicates b263 refused to index over — find out whose they are, then clear only what is safe.
--
-- ⚠️⚠️ DRAFT — NOT RUN.
--
-- ── RUN IT **WITHOUT RLS** ── Supabase SQL editor, as `postgres`. Not `railway run`. ─────────────────
--
--   · Step 1 has to see EVERY entity at once — that is its whole job: telling a throwaway test shop from a real
--     one before anything is deleted. Under RLS you see exactly one entity, so the answer would be a subset and
--     you could not tell which.
--   · It joins `identities` for the shop NAME, which is a cross-entity read.
--   · Step 3 deletes across several entities at once.
--
-- ⚠⚠ AND THE FAILURE MODE IF YOU RUN IT UNDER RLS IS THE QUIETEST ONE ON THE PLATFORM. `cb_app` with no
-- `app.current_entity` set makes every policy false, so step 1 comes back with ZERO ROWS — which reads exactly
-- like "there are no duplicates". You would then run b263 again, get the same 23505, and have no idea why. An
-- empty answer here means nothing until you know which role asked the question. [[feedback-state-rls-status]]
--
-- ⚠ THE COST OF RLS-OFF, said plainly: nothing is guarding the entity_id in step 3 but the person typing it. A
-- wrong uuid there deletes from a real shop's books and no policy will stop it. That is why the list is empty in
-- the file and has to be filled in by hand, from step 1's own output, after reading the names.
--
-- b263 step 2 answered, correctly:
--     ERROR: 23505: could not create unique index "ux_chit_client_ref_per_entity"
--     DETAIL: Key (entity_id, (business_json ->> 'client_ref'))=(10513b58-…, C1/26-27/0033) is duplicated.
--
-- That entity is `offline40mu72vxpa` — a throwaway shop my own R2 test made on 2026-09-18 while proving the
-- duplicate-bill fault. The refusal is the index doing its job on the first try.
--
-- ⚠️ WHAT THIS FILE WILL NOT DO IS DELETE ANYTHING ON A GUESS. A duplicate in a REAL shop is a second voucher for
-- a real sale, and each copy may have written its own stock movements — so removing one copy without reversing
-- its movements leaves that shop's stock wrong in a new way. Step 1 says whose they are; step 3 only ever touches
-- the entity ids typed into it by hand, after reading step 1.


-- ═══ 1 · WHOSE ARE THEY ══════════════════════════════════════════════════════════════════════════════════════
-- Run this first. The shop NAME is the whole point: a name like offline40…, ladder…, draftkill…, catkeys…,
-- arrange…, kot… or shopgroups… is a test fixture and can go. Anything else is a real shop and stops here.

SELECT i.display_name                              AS shop,
       h.entity_id,
       count(DISTINCT h.business_json->>'client_ref') AS bill_numbers_affected,
       count(*)                                    AS total_copies,
       min(h.created_at)                           AS first_at,
       max(h.created_at)                           AS last_at
  FROM chit_header h
  JOIN (
        SELECT entity_id, business_json->>'client_ref' AS ref
          FROM chit_header
         WHERE business_json->>'client_ref' IS NOT NULL
         GROUP BY 1, 2 HAVING count(*) > 1
       ) d ON d.entity_id = h.entity_id AND d.ref = h.business_json->>'client_ref'
  LEFT JOIN identities i ON i.identity_id = h.entity_id
 GROUP BY 1, 2
 ORDER BY total_copies DESC;


-- ═══ 2 · WHAT EACH COPY CARRIES ══════════════════════════════════════════════════════════════════════════════
-- Only needed if step 1 shows a REAL shop. `keep` marks the earliest copy of each bill — the one the server's own
-- dedupe has always returned (ORDER BY created_at LIMIT 1), so it is the copy anything else already points at.

SELECT i.display_name AS shop,
       h.business_json->>'client_ref' AS bill_no,
       h.chit_id,
       h.created_at,
       row_number() OVER (PARTITION BY h.entity_id, h.business_json->>'client_ref'
                              ORDER BY h.created_at) = 1 AS keep,
       h.purpose,
       h.summary_json->'money'->>'total' AS total,
       (SELECT count(*) FROM chit_detail d WHERE d.chit_id = h.chit_id) AS detail_rows,
       /**
        * ⚠⚠ stock_movement HAS NO chit_id — I assumed it did and the editor said so (42703). It is keyed by
        * `ref`, which is the BILL NUMBER (b214: "the SAME client_ref the chit carries"). That is not a
        * nuisance, it is the finding: both copies of a duplicated bill wrote movements under the SAME ref, so
        * the rows cannot be attributed to a copy at all — and the shop's stock was decremented TWICE.
        * So this counts them per BILL, not per chit; the same number repeats on each copy's row on purpose.
        */
       (SELECT count(*) FROM stock_movement m
         WHERE m.entity_id = h.entity_id AND m.ref = h.business_json->>'client_ref') AS stock_rows_for_this_bill
  FROM chit_header h
  JOIN (
        SELECT entity_id, business_json->>'client_ref' AS ref
          FROM chit_header
         WHERE business_json->>'client_ref' IS NOT NULL
         GROUP BY 1, 2 HAVING count(*) > 1
       ) d ON d.entity_id = h.entity_id AND d.ref = h.business_json->>'client_ref'
  LEFT JOIN identities i ON i.identity_id = h.entity_id
 ORDER BY shop, bill_no, h.created_at;


-- ═══ 3 · CLEAR THE TEST SHOPS ════════════════════════════════════════════════════════════════════════════════
-- ⚠️⚠️ PASTE THE ENTITY IDS FROM STEP 1 INTO THE LIST BELOW, BY HAND, AND ONLY THE TEST ONES. The list is
-- deliberately empty: a cleanup that defaults to "everything I found" is how a real shop's books get edited by a
-- script written for test data.
--
-- It keeps the EARLIEST copy of every bill and removes the later ones, with their children, inside one
-- transaction. Run it as one block.

BEGIN;

-- ⭐ every id typed here, and nothing else, is in scope
CREATE TEMP TABLE _scope (entity_id uuid) ON COMMIT DROP;
INSERT INTO _scope (entity_id) VALUES
  -- ('10513b58-a79a-4356-9ade-f14c51c40717'),   -- offline40mu72vxpa   ← uncomment the ones step 1 showed as tests
  (NULL);
DELETE FROM _scope WHERE entity_id IS NULL;

-- the surplus copies: every duplicate except the earliest of each bill
CREATE TEMP TABLE _surplus ON COMMIT DROP AS
SELECT h.chit_id, h.entity_id, h.business_json->>'client_ref' AS bill_no
  FROM (
        SELECT chit_id, entity_id, business_json, created_at,
               row_number() OVER (PARTITION BY entity_id, business_json->>'client_ref'
                                      ORDER BY created_at) AS n
          FROM chit_header
         WHERE business_json->>'client_ref' IS NOT NULL
           AND entity_id IN (SELECT entity_id FROM _scope)
       ) h
 WHERE h.n > 1;

-- ⚠️ SAY WHAT IS ABOUT TO GO, before it goes — read this number, then COMMIT or ROLLBACK
SELECT count(*) AS copies_to_remove, count(DISTINCT bill_no) AS bills_affected FROM _surplus;

-- children first; a delete that trips an FK halfway leaves a worse mess than the one it was clearing
DELETE FROM chit_detail WHERE chit_id IN (SELECT chit_id FROM _surplus);
DELETE FROM chit_header WHERE chit_id IN (SELECT chit_id FROM _surplus);

-- ⚠⚠ STOCK IS DELIBERATELY NOT TOUCHED HERE, and this is the one paragraph to read before deciding it is an
-- oversight. stock_movement is keyed by `ref` = the bill number, NOT by chit_id, so both copies' movements are
-- indistinguishable rows under one reference. Nothing here can tell which belongs to the copy being removed.
--   · On a TEST shop it does not matter — nobody counts that stock, and the index only cares about chit_header.
--   · On a REAL shop it matters a great deal: the shelf was decremented twice for those bills and is short by
--     exactly the duplicated quantity. Deleting half the rows blind would be a second guess on top of the first.
-- That correction is its own decision, with its own count sheet. See C:\dev\BACKLOG.md.
-- This query shows the damage per bill, if step 1 named a real shop:
--   SELECT m.entity_id, m.ref AS bill_no, m.item_id, m.reason, count(*) AS movement_rows, sum(m.qty) AS qty_moved
--     FROM stock_movement m
--     JOIN (SELECT entity_id, business_json->>'client_ref' AS ref FROM chit_header
--            WHERE business_json->>'client_ref' IS NOT NULL
--            GROUP BY 1,2 HAVING count(*) > 1) d
--       ON d.entity_id = m.entity_id AND d.ref = m.ref
--    GROUP BY 1,2,3,4 HAVING count(*) > 1 ORDER BY 1,2;

-- ⚠️ IF EITHER DELETE ERRORS ON A TABLE NOT LISTED HERE, this query names what else points at a chit —
-- run it, add the table, and start the block again. Nothing is committed until the line below.
--   SELECT c.conrelid::regclass AS referencing_table, a.attname AS column
--     FROM pg_constraint c JOIN unnest(c.conkey) k(attnum) ON true
--     JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = k.attnum
--    WHERE c.contype = 'f' AND c.confrelid = 'chit_header'::regclass;

COMMIT;
-- ROLLBACK;   -- ← use this instead if the count above was not what you expected


-- ═══ 4 · THEN RUN b263 STEP 2 AGAIN ══════════════════════════════════════════════════════════════════════════
-- It is idempotent; it will build this time, and its proof query should return one row.
