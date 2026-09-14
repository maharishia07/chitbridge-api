-- ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════
-- b226 — CONNECT THE SHOPS THAT REGISTERED BEFORE THERE WAS A ROOT.
-- ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════
--
-- Athi, 2026-09-14: *"now we should see all the registered entities under cbincroot."*
--
-- `lib/rootlink.js` connects every NEW registration from the moment PLATFORM_ROOT_ENTITY is set. This is the
-- one-time catch-up for everyone who registered before that — the 90 real customers on 2026-09-14.
--
-- ⚠️ REQUIRES b225. The predicate is `entity_kind = 'customer'`. Without b225 the only way to say that was
--    `identity_type = 'entity'`, which is all 2,502 rows — and this migration would have put 2,163 test
--    fixtures, 238 branches, 10 local suppliers and 89 walk-in shoppers into the operator's customer list, plus
--    written a supplier row into every one of their entities. It would have been the single most damaging thing
--    written today, and only b225 makes it safe to run at all.
--
-- ── ⭐ WHAT IT WRITES, AND WHY IT IS TWO ROWS AND NOT A LINK ────────────────────────────────────────────────────
--
-- Both relationship lists are ONE-SIDED by design (routes/relationships.js: "SUPPLIERS (no consent — D-056)",
-- "CUSTOMERS (auto-added — D-065)"). `owner_entity_id` owns the list. So:
--
--     customer_list   owner = cbincroot, customer = the shop   → OUR record of who our customers are
--     supplier_list   owner = the shop, supplier = cbincroot   → THEIR record of who supplies them
--
-- ⚠️⚠️ THE SECOND WRITES INTO 90 OTHER PEOPLE'S ENTITIES. That is why this is a migration and not an API loop:
--    it needs the owner role, it happens ONCE, deliberately, and it is visible in this folder forever. It is the
--    same thing rootlink.js does at the mint, applied retrospectively to shops that were minted earlier.
--
-- ⭐ added_via = 'system' on both, so the row can be told apart from one a shop chose. Two things depend on that
--    mark and neither is built yet: the supplier screen must refuse to delete it, and any SUPPLIER QUOTA COUNT
--    must exclude it — Starter allows ten suppliers and we would otherwise silently take one from every shop.
--
-- ⚠️ NOT REVERSIBLE BY RE-RUNNING. It is idempotent (ON CONFLICT DO NOTHING), so running it twice is safe, but
--    undoing it means deleting rows. The rollback is at the bottom, commented out.
--
-- ⚠️⚠️ REQUIRES b227, RUN IT FIRST. The first attempt at this migration FAILED:
--       ERROR: 23514 new row for relation "customer_list" violates check constraint "customer_list_added_via_check"
--    added_via had no 'system' member. b227 adds one. supply_kind was my error, not the schema's — 'service'
--    was invented when 'own_use' already existed and is correct, and this file now writes own_use.
--
-- Supabase → SQL Editor → paste → Run. Step 1 only looks.
-- ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════
-- ⚠️⚠️ RENUMBERED 2026-09-14. This was written as b158, and b158 WAS ALREADY TAKEN by
--    b158_state_log_fanout.sql. Eight files written today collided the same way: I saw b151 and
--    b154 in the folder and assumed the series ended there. It is at 222.
-- ⭐ THIS ONE HAS ALREADY BEEN RUN against production, as b158. The file name is recorded nowhere,
--    so the rename changes nothing that happened — but do not run it again expecting it to be new. It is
--    idempotent, so re-running is harmless if you are unsure.
--

-- ── 1 · LOOK FIRST. Who would be connected, and who is already? ────────────────────────────────────────────────
WITH root AS (SELECT identity_id FROM identities WHERE user_id = 'cbincroot' AND entity_kind = 'internal')
SELECT (SELECT count(*) FROM root)                                              AS root_found,
       (SELECT count(*) FROM identities
         WHERE entity_kind = 'customer' AND coalesce(status,'active') <> 'erased') AS customers_to_link,
       (SELECT count(*) FROM customer_list cl, root r
         WHERE cl.owner_entity_id = r.identity_id)                              AS already_our_customers,
       (SELECT count(*) FROM supplier_list sl, root r
         WHERE sl.supplier_entity_id = r.identity_id)                           AS already_list_us;

-- ⭐ EXPECTED on 2026-09-14: root_found 1 · customers_to_link 90 · already 0 · already 0.
-- ⚠️ IF root_found IS 0, STOP. Either cbincroot does not exist or b225 did not mark it 'internal', and every
--    statement below would silently do nothing while appearing to succeed.

-- ── 2 · THE CONNECTION ─────────────────────────────────────────────────────────────────────────────────────────
BEGIN;

-- 2a · they become our customers
INSERT INTO customer_list (owner_entity_id, customer_identity_id, customer_type, added_via)
SELECT r.identity_id, e.identity_id, 'entity', 'system'
  FROM identities e
 CROSS JOIN (SELECT identity_id FROM identities
              WHERE user_id = 'cbincroot' AND entity_kind = 'internal') r
 WHERE e.entity_kind = 'customer'
   AND coalesce(e.status, 'active') <> 'erased'
   AND e.identity_id <> r.identity_id            -- ⚠️ the root is not its own customer
ON CONFLICT (owner_entity_id, customer_identity_id) DO NOTHING;

-- 2b · we become their supplier
INSERT INTO supplier_list (owner_entity_id, supplier_entity_id, supply_kind, added_via)
SELECT e.identity_id, r.identity_id, 'own_use', 'system'
  FROM identities e
 CROSS JOIN (SELECT identity_id FROM identities
              WHERE user_id = 'cbincroot' AND entity_kind = 'internal') r
 WHERE e.entity_kind = 'customer'
   AND coalesce(e.status, 'active') <> 'erased'
   AND e.identity_id <> r.identity_id
ON CONFLICT (owner_entity_id, supplier_entity_id) DO NOTHING;

COMMIT;

-- ── 3 · WHAT YOU SHOULD SEE ────────────────────────────────────────────────────────────────────────────────────
WITH root AS (SELECT identity_id FROM identities WHERE user_id = 'cbincroot' AND entity_kind = 'internal')
SELECT (SELECT count(*) FROM customer_list cl, root r WHERE cl.owner_entity_id = r.identity_id)    AS our_customers,
       (SELECT count(*) FROM supplier_list sl, root r WHERE sl.supplier_entity_id = r.identity_id) AS shops_listing_us;
-- ⭐ Both should read 90, and should stay equal to each other forever. If they ever diverge, one half of a
--    connection was written without the other — see lib/rootlink.js, which reports its two halves separately
--    for exactly this reason.

-- ── 4 · THE ROLLBACK, if this turns out to be wrong. NOT commented out by accident — read it before running. ───
-- ⚠️ It removes ONLY rows marked added_via = 'system', so a supplier a shop chose for itself is never touched.
--
-- BEGIN;
-- WITH root AS (SELECT identity_id FROM identities WHERE user_id = 'cbincroot')
-- DELETE FROM customer_list cl USING root r
--  WHERE cl.owner_entity_id = r.identity_id AND cl.added_via = 'system';
-- WITH root AS (SELECT identity_id FROM identities WHERE user_id = 'cbincroot')
-- DELETE FROM supplier_list sl USING root r
--  WHERE sl.supplier_entity_id = r.identity_id AND sl.added_via = 'system';
-- COMMIT;
