-- b263b: the duplicates b263 refused to index over — find out whose they are, then clear only what is safe.
--
-- ⚠️⚠️ DRAFT — NOT RUN. Supabase SQL editor, as superuser (RLS off), because this has to see EVERY entity at once
-- and `cb_app` can only ever see one.
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
       (SELECT count(*) FROM chit_detail    d WHERE d.chit_id = h.chit_id) AS detail_rows,
       (SELECT count(*) FROM stock_movement m WHERE m.chit_id = h.chit_id) AS stock_rows
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
DELETE FROM stock_movement WHERE chit_id IN (SELECT chit_id FROM _surplus);
DELETE FROM chit_detail    WHERE chit_id IN (SELECT chit_id FROM _surplus);
DELETE FROM chit_header    WHERE chit_id IN (SELECT chit_id FROM _surplus);

-- ⚠️ IF ANY OF THE THREE DELETES ERRORS ON A TABLE NOT LISTED HERE, this query names what else points at a chit —
-- run it, add the table, and start the block again. Nothing is committed until the line below.
--   SELECT c.conrelid::regclass AS referencing_table, a.attname AS column
--     FROM pg_constraint c JOIN unnest(c.conkey) k(attnum) ON true
--     JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = k.attnum
--    WHERE c.contype = 'f' AND c.confrelid = 'chit_header'::regclass;

COMMIT;
-- ROLLBACK;   -- ← use this instead if the count above was not what you expected


-- ═══ 4 · THEN RUN b263 STEP 2 AGAIN ══════════════════════════════════════════════════════════════════════════
-- It is idempotent; it will build this time, and its proof query should return one row.
