-- scripts/rls-proof-seed.sql — B1 RLS · Part 3.5: the two-tenant PROOF SEED (make leak vs isolation UNMISTAKABLE).
-- Run as POSTGRES (BYPASSRLS) — one pass writes all tenants. NEVER seed as cb_app (it fail-closes mid-seed).
-- Deterministic + idempotent (fixed synthetic UUIDs, delete-then-reload). The SAME seed must go RED with RLS off
-- and GREEN with RLS on — that contrast IS the demonstration. Safe to re-run. Test data only.
--
-- Tenants:  A = 0a0a0a0a-…-000a (7 chits, incl. a SENTINEL high-value chit)
--           B = 0b0b0b0b-…-000b (3 chits)   ·   C = 0c0c0c0c-…-000c (empty/negative)
-- Assertions the suite runs on this (guidance §3.5): B must see B only; A's sentinel invisible; B cannot
-- update/delete/insert into A; B can still RESOLVE A by display_name/bridge_id (carve-out); no-context -> 0 rows.

BEGIN;

-- ── idempotency: clear prior seed rows for the three test tenants (children before parents) ──
DELETE FROM chit_status     WHERE entity_id       IN ('0a0a0a0a-0000-0000-0000-00000000000a','0b0b0b0b-0000-0000-0000-00000000000b','0c0c0c0c-0000-0000-0000-00000000000c');
DELETE FROM chit_detail     WHERE entity_id       IN ('0a0a0a0a-0000-0000-0000-00000000000a','0b0b0b0b-0000-0000-0000-00000000000b','0c0c0c0c-0000-0000-0000-00000000000c');
DELETE FROM state_log       WHERE entity_id       IN ('0a0a0a0a-0000-0000-0000-00000000000a','0b0b0b0b-0000-0000-0000-00000000000b','0c0c0c0c-0000-0000-0000-00000000000c');
DELETE FROM chit_header     WHERE entity_id       IN ('0a0a0a0a-0000-0000-0000-00000000000a','0b0b0b0b-0000-0000-0000-00000000000b','0c0c0c0c-0000-0000-0000-00000000000c');
DELETE FROM catalogue_items WHERE entity_id       IN ('0a0a0a0a-0000-0000-0000-00000000000a','0b0b0b0b-0000-0000-0000-00000000000b','0c0c0c0c-0000-0000-0000-00000000000c');
DELETE FROM customer_list   WHERE owner_entity_id IN ('0a0a0a0a-0000-0000-0000-00000000000a','0b0b0b0b-0000-0000-0000-00000000000b','0c0c0c0c-0000-0000-0000-00000000000c')
                               OR customer_identity_id IN ('0a0a0a0a-0000-0000-0000-00000000000a','0b0b0b0b-0000-0000-0000-00000000000b','0c0c0c0c-0000-0000-0000-00000000000c');

-- ── S1/S6: the entities (also the carve-out rows: discoverable cross-tenant by display_name/bridge_id) ──
INSERT INTO identities (identity_id, bridge_id, display_name, email, identity_type, status) VALUES
  ('0a0a0a0a-0000-0000-0000-00000000000a','RLSSEEDA','Acme Cement',      'tenant-a@rls.seed','entity','active'),
  ('0b0b0b0b-0000-0000-0000-00000000000b','RLSSEEDB','BuildCo Supplies', 'tenant-b@rls.seed','entity','active'),
  ('0c0c0c0c-0000-0000-0000-00000000000c','RLSSEEDC','Empty Tenant',     'tenant-c@rls.seed','entity','active')
ON CONFLICT (identity_id) DO UPDATE SET bridge_id=EXCLUDED.bridge_id, display_name=EXCLUDED.display_name, email=EXCLUDED.email, status='active';

-- ── S2/S4/S5: A = 7 chits; chit #7 is the SENTINEL (high value; B must never see it). Referential consistency (S5). ──
INSERT INTO chit_header (chit_id, entity_id, sender_entity_id, sender_entity_bridge_id, sender_entity_display_name, purpose, manual_subject)
SELECT ('a11c0000-0000-0000-0000-'||lpad(i::text,12,'0'))::uuid, '0a0a0a0a-0000-0000-0000-00000000000a', '0a0a0a0a-0000-0000-0000-00000000000a', 'RLSSEEDA', 'Acme Cement', 'order',
       CASE WHEN i=7 THEN 'SENTINEL — high-value order (B must never see)' ELSE 'A order '||i END
FROM generate_series(1,7) AS i;
INSERT INTO chit_status (chit_id, entity_id, current_status)
SELECT ('a11c0000-0000-0000-0000-'||lpad(i::text,12,'0'))::uuid, '0a0a0a0a-0000-0000-0000-00000000000a', 'pending' FROM generate_series(1,7) AS i;
INSERT INTO chit_detail (chit_id, entity_id, detail_type, line_item_count, total_value, currency_code)
SELECT ('a11c0000-0000-0000-0000-'||lpad(i::text,12,'0'))::uuid, '0a0a0a0a-0000-0000-0000-00000000000a', 'order', 1,
       CASE WHEN i=7 THEN 9999999.00 ELSE (i*1000)::decimal END, 'INR' FROM generate_series(1,7) AS i;
INSERT INTO state_log (chit_id, entity_id, action, new_status, detail)
SELECT ('a11c0000-0000-0000-0000-'||lpad(i::text,12,'0'))::uuid, '0a0a0a0a-0000-0000-0000-00000000000a', 'created', 'pending',
       CASE WHEN i=7 THEN 'SENTINEL row' ELSE 'A chit '||i END FROM generate_series(1,7) AS i;

-- ── B = 3 chits (asymmetric volume — a leak shows at a glance: B should see 3, a leak shows 10) ──
INSERT INTO chit_header (chit_id, entity_id, sender_entity_id, sender_entity_bridge_id, sender_entity_display_name, purpose, manual_subject)
SELECT ('b11c0000-0000-0000-0000-'||lpad(i::text,12,'0'))::uuid, '0b0b0b0b-0000-0000-0000-00000000000b', '0b0b0b0b-0000-0000-0000-00000000000b', 'RLSSEEDB', 'BuildCo Supplies', 'order', 'B order '||i
FROM generate_series(1,3) AS i;
INSERT INTO chit_status (chit_id, entity_id, current_status)
SELECT ('b11c0000-0000-0000-0000-'||lpad(i::text,12,'0'))::uuid, '0b0b0b0b-0000-0000-0000-00000000000b', 'pending' FROM generate_series(1,3) AS i;
INSERT INTO chit_detail (chit_id, entity_id, detail_type, line_item_count, total_value, currency_code)
SELECT ('b11c0000-0000-0000-0000-'||lpad(i::text,12,'0'))::uuid, '0b0b0b0b-0000-0000-0000-00000000000b', 'order', 1, (i*500)::decimal, 'INR' FROM generate_series(1,3) AS i;
INSERT INTO state_log (chit_id, entity_id, action, new_status, detail)
SELECT ('b11c0000-0000-0000-0000-'||lpad(i::text,12,'0'))::uuid, '0b0b0b0b-0000-0000-0000-00000000000b', 'created', 'pending', 'B chit '||i FROM generate_series(1,3) AS i;

-- ── S3: value-identical collisions on the RLS-protected tables (isolation must hold on IDENTICAL-looking rows) ──
INSERT INTO catalogue_items (entity_id, item_data, is_active) VALUES
  ('0a0a0a0a-0000-0000-0000-00000000000a', '{"name":"Cement — 50kg","price":380}'::jsonb, true),   -- SAME name in A and B
  ('0a0a0a0a-0000-0000-0000-00000000000a', '{"name":"River sand — 1 ton","price":1800}'::jsonb, true),
  ('0b0b0b0b-0000-0000-0000-00000000000b', '{"name":"Cement — 50kg","price":380}'::jsonb, true),   -- identical to A's row
  ('0b0b0b0b-0000-0000-0000-00000000000b', '{"name":"Steel rod — 12mm","price":650}'::jsonb, true);

-- customer_list: both A and B list C as a customer -> exercises the owner_entity_id predicate (B sees only its own row)
INSERT INTO customer_list (owner_entity_id, customer_identity_id, customer_type) VALUES
  ('0a0a0a0a-0000-0000-0000-00000000000a', '0c0c0c0c-0000-0000-0000-00000000000c', 'entity'),
  ('0b0b0b0b-0000-0000-0000-00000000000b', '0c0c0c0c-0000-0000-0000-00000000000c', 'entity');

COMMIT;

-- Quick manual check (as postgres, RLS off): A has 7, B has 3.
--   SELECT entity_id, count(*) FROM chit_header WHERE entity_id IN
--     ('0a0a0a0a-0000-0000-0000-00000000000a','0b0b0b0b-0000-0000-0000-00000000000b') GROUP BY 1;
-- The RED/GREEN contrast is proven by scripts/isolation-suite.sh binding context to A then B (see guidance §3.5 matrix).
