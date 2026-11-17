-- ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════
-- b246 — TEST IS NOT A KIND OF SHOP. It is a second question about any shop.
-- ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════
--
-- Athi, 2026-09-14:
--
--   *"so do we have a mechanism of marking an entity as Test? This is required going forward as well — for some
--    reason a human tester wants to test the feature in the real system, he can create a test entity and test
--    it, and it should not mix it up with production at all."*
--   *"so we may create one for goods, services, network etc, to verify the feature released in production."*
--
-- ── ⚠️⚠️ THE SECOND SENTENCE IS IMPOSSIBLE TODAY, AND THAT IS THE WHOLE PROBLEM ─────────────────────────────────
--
-- `test` is a VALUE of entity_kind. So a test NETWORK would have to stop being a network to be a test, and a
-- test SUPPLIER would stop being a supplier. "One for goods, services, network" cannot be expressed at all.
--
-- ⭐⭐ IT IS THE SAME MISTAKE AS THE CLASS DROPDOWN, one layer down in the schema: a PARTITION used where an AXIS
-- was needed. "What is it?" and "does it count?" are two questions, and cramming them into one column means
-- answering one costs you the other.
--
--     entity_kind   customer · network · supplier · internal · actor · shopper   WHAT IT IS
--     is_test       true · false                                                 WHETHER IT COUNTS
--
-- And "how many customers do we have" becomes answerable, because the 2,243 fixtures stop hiding inside a kind
-- that was never true of them — they were registrations, so they were customers, and they were tests.
--
-- ── ⭐ WHAT THIS FIXES THAT A DETECTOR NEVER COULD ──────────────────────────────────────────────────────────────
--
-- Today the flag is guessed from the email domain at registration (lib/entitykind.js, FIXTURE_DOMAINS). That is
-- a detector, not a mechanism, and it only watches ONE of the three doors:
--
--   registration   ✅ caught — 2,243 e2e signups
--   mint           ❌ a network branch has NO EMAIL. 232 script-made branches were never marked.
--   the API        ❌ a supplier created by a script has a perfectly real address.
--
-- A human tester with a real inbox could never mark their own account at all. A column can be set at every door.
--
-- ── ⚠️⚠️ ONE-WAY, AND THE TRIGGER IS THE POINT ──────────────────────────────────────────────────────────────────
--
-- real → test is allowed: it is how noise gets reclassified, and Athi is doing exactly that below.
-- test → real is REFUSED. If a test entity can be promoted, test data walks into production and no filter on
-- any screen can undo it afterwards. The one direction that must never happen is the one worth enforcing.
--
-- ── ⚠️ WHAT THIS MIGRATION DOES NOT DO ──────────────────────────────────────────────────────────────────────────
--
-- Athi also confirmed: *a test entity may only transact with a test entity.* That is the rule with real teeth —
-- without it, a tester's shop sends a chit to a real shop and there is test data in a real business's books
-- forever. IT IS NOT IN THIS FILE. It belongs in the chit path, it will REJECT things, and it must not ride in
-- on a schema migration. Tracked as the next piece of work, not as done.
--
-- Supabase → SQL Editor → paste → Run — ⭐ WITHOUT RLS (as `postgres`).
-- ⚠️ Structure needs OWNERSHIP: CREATE/ALTER/GRANT and triggers are refused to a role that merely has
--    rights on the rows. The rule of thumb for this repo:
--        structure, or data read ACROSS shops  → WITHOUT RLS (as the owner)
--        data written FOR ONE shop             → WITH RLS, so the database refuses a row that lands in
--                                                the wrong shop
-- ⚠️ Being the owner is NOT the same as bypassing RLS. A table marked FORCE ROW LEVEL SECURITY applies its
--    policies to its owner too — that is the whole difference between ENABLE and FORCE — so a statement
--    touching chit_header, customer_list, catalogue_items or cb_attachment can still be refused here.
-- Idempotent.
-- ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════

BEGIN;

-- ── ① the axis ─────────────────────────────────────────────────────────────────────────────────────────────────
ALTER TABLE identities ADD COLUMN IF NOT EXISTS is_test boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN identities.is_test IS
  'Does this entity count? Orthogonal to entity_kind, which says WHAT it is. Set at registration, inherited at '
  'mint from the network root, or set by the operator. One-way: real may become test, never the reverse.';

-- ⚠️ every population query filters on it, and it is a two-value column on 2,509 rows — so index it WITH the
--    kind it is almost always read beside, rather than on its own where postgres would ignore it.
CREATE INDEX IF NOT EXISTS identities_is_test_kind_idx ON identities (is_test, entity_kind);

-- ── ② the 2,243 that were hiding inside a kind ──────────────────────────────────────────────────────────────────
-- ⚠️ They self-registered, so they are CUSTOMERS that are tests. Leaving entity_kind='test' would keep the
--    partition alive beside the axis meant to replace it, and something would go on reading it.
UPDATE identities
   SET is_test = true,
       entity_kind = 'customer'
 WHERE entity_kind = 'test';

-- ── ③ the script-made networks — marked by their ROOT, because a branch belongs to its network ──────────────────
--
-- ⭐ THIS IS THE INHERITANCE RULE, APPLIED ONCE AS A BACKFILL. A branch of a test network is a test entity by
-- construction; nobody has to remember to tag it. Going forward the mint does this, but the 232 rows already in
-- the table predate that and are reachable only through the tree.
--
-- ⚠️ Named from the SCRIPTS THAT CREATE THEM, not from what the names look like:
--     'Athi Test Network'  scripts/prove-network-mint.js:54   ← mine, despite the name
--     'Cascade …'          routes/network-design.js
--     Avail / Login / Order / Place / Reach — the e2e flow fixtures, one prefix per flow
UPDATE identities i
   SET is_test = true
  FROM cb_entity c
  JOIN cb_entity root ON root.path = subpath(c.path, 0, 1)
 WHERE c.bridge_id = i.bridge_id
   AND i.is_test = false
   AND (root.name = 'Athi Test Network'
     OR root.name LIKE 'Cascade %'
     OR root.name LIKE 'Avail av%'
     OR root.name LIKE 'Login %'
     OR root.name LIKE 'Order %'
     OR root.name LIKE 'Place %'
     OR root.name LIKE 'Reach %');

-- ── ④ the script-made suppliers ────────────────────────────────────────────────────────────────────────────────
-- ⚠️ ONLY THE SIX-DIGIT ONES. Athi: *"as long as you are very clear about yours, we can keep them as test."*
--    'Corner Hardware 443625' carries a generated suffix and is unambiguous. 'Corner Hardware X / Y / Z' do not,
--    and he could not say either — so they stay REAL. Wrong in the recoverable direction: a fixture left on the
--    books is visible and fixable; one of his shops quietly hidden is neither.
UPDATE identities
   SET is_test = true
 WHERE entity_kind = 'supplier'
   AND is_test = false
   AND display_name ~ '^Corner Hardware [0-9]{6}$';

-- ── ⑤ one-way ──────────────────────────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION identities_is_test_is_one_way() RETURNS trigger
LANGUAGE plpgsql AS $fn$
BEGIN
  IF OLD.is_test AND NOT NEW.is_test THEN
    RAISE EXCEPTION 'a test entity cannot be promoted to production (%)', coalesce(OLD.user_id, OLD.display_name)
      USING HINT = 'Create a new entity instead. Test data must never be able to walk into the real books.',
            ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$fn$;

DROP TRIGGER IF EXISTS identities_is_test_one_way ON identities;
CREATE TRIGGER identities_is_test_one_way
  BEFORE UPDATE OF is_test ON identities
  FOR EACH ROW WHEN (OLD.is_test IS DISTINCT FROM NEW.is_test)
  EXECUTE FUNCTION identities_is_test_is_one_way();

COMMIT;

-- ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════
-- ⭐ READ IT — the baseline Athi asked for: *"today we are baselining so I know the segregation and I can count
--    and test only based on those data."*
-- ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════

SELECT is_test, entity_kind, count(*)::int AS n
  FROM identities
 WHERE identity_type = 'entity' AND coalesce(status,'active') <> 'erased'
 GROUP BY 1, 2 ORDER BY 1, 3 DESC;

-- ⭐ THE REAL PLATFORM, IN FULL. Expect ~24 rows: nine customers, alpha timers' six branches, nine internal,
--    and the Corner Hardware X/Y/Z that could not be attributed.
SELECT coalesce(i.user_id, i.display_name) AS who, i.entity_kind, i.supplies,
       coalesce(root.name, '—') AS network
  FROM identities i
  LEFT JOIN cb_entity c    ON c.bridge_id = i.bridge_id
  LEFT JOIN cb_entity root ON root.path = subpath(c.path, 0, 1)
 WHERE i.identity_type = 'entity' AND coalesce(i.status,'active') <> 'erased' AND i.is_test = false
 ORDER BY i.entity_kind, who;

-- ⚠️ AND PROVE THE TRIGGER FIRES — a guard nobody has seen refuse anything is a guard you hope exists.
DO $$
DECLARE victim uuid; promoted boolean := false;
BEGIN
  SELECT identity_id INTO victim FROM identities WHERE is_test LIMIT 1;
  IF victim IS NULL THEN RAISE NOTICE 'b246: no test entity to check against — trigger UNPROVEN.'; RETURN; END IF;
  BEGIN
    UPDATE identities SET is_test = false WHERE identity_id = victim;
    promoted := true;
  EXCEPTION WHEN check_violation THEN
    RAISE NOTICE 'b246: ✓ the guard fired — a test entity cannot be promoted to production.';
  END;
  IF promoted THEN RAISE EXCEPTION 'b246: ✗ THE GUARD DID NOT FIRE. Test data can still be promoted.'; END IF;
END $$;
