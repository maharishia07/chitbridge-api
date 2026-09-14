-- ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════
-- b248 — A PERSON BELONGS TO THE SHOP THEY WORK FOR
-- ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════
--
-- b246 split "what is it" from "does it count", and marked every ENTITY. It did not mark the people inside
-- them. An actor of a test shop is still `is_test = false`, so:
--
--   · the Platform screen's "by type" breakdown counts test staff among the real population
--   · a seat check against a plan cap counts them
--   · anything that ever asks "how many people are on the rail" is over by the size of the test suite
--
-- ⭐ AND IT IS NOT A LIST OF EXCEPTIONS, IT IS ONE RULE: a child belongs to the population of its parent. The
-- same rule b246 applied down the network tree (a branch belongs to its root), applied down the staff tree.
-- Stated once, enforced on insert, so nobody has to remember it when the next kind of child row is invented.
--
-- ── ⚠️ THE BACKFILL ONLY GOES ONE WAY, AND NOT BECAUSE OF THE TRIGGER ───────────────────────────────────────────
--
-- b246 made is_test one-way: test may never become production. So `SET is_test = parent.is_test` would be
-- REFUSED for any child that is somehow already test under a production parent — and rightly. The backfill
-- therefore only promotes production → test, which is the direction that needs fixing and the only direction
-- that is safe. A child marked test under a real parent is a fact worth looking at, not one to overwrite.
--
-- ⚠️ REQUIRES b246.
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

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                  WHERE table_schema='public' AND table_name='identities' AND column_name='is_test') THEN
    RAISE EXCEPTION 'b248 needs b246 — identities.is_test does not exist yet. Run b246 first.';
  END IF;
END $$;

-- ── ① what is currently mis-filed ──────────────────────────────────────────────────────────────────────────────
SELECT child.entity_kind, count(*)::int AS counted_as_real_but_parent_is_test
  FROM identities child
  JOIN identities parent ON parent.identity_id = child.parent_entity_id
 WHERE parent.is_test AND NOT child.is_test
   AND coalesce(child.status,'active') <> 'erased'
 GROUP BY 1 ORDER BY 2 DESC;

-- ── ② the backfill ─────────────────────────────────────────────────────────────────────────────────────────────
UPDATE identities child
   SET is_test = true
  FROM identities parent
 WHERE parent.identity_id = child.parent_entity_id
   AND parent.is_test
   AND NOT child.is_test;

-- ── ③ ⭐ AND THE RULE, so it holds for rows that do not exist yet ───────────────────────────────────────────────
-- ⚠️ BEFORE INSERT, not a check: it SETS the value rather than refusing a wrong one. A caller creating a member
--    of staff has no business knowing about populations, and making it pass the right flag would mean every
--    future create path has to remember — which is the failure mode b246's header is about.
CREATE OR REPLACE FUNCTION identities_inherit_population() RETURNS trigger
LANGUAGE plpgsql AS $fn$
DECLARE parent_is_test boolean;
BEGIN
  IF NEW.parent_entity_id IS NULL THEN RETURN NEW; END IF;
  SELECT is_test INTO parent_is_test FROM identities WHERE identity_id = NEW.parent_entity_id;
  /* ⚠️ a parent we cannot find is not a reason to refuse the child — it is a reason to leave it alone. */
  IF parent_is_test IS TRUE THEN NEW.is_test := true; END IF;
  RETURN NEW;
END
$fn$;

DROP TRIGGER IF EXISTS identities_population_inheritance ON identities;
CREATE TRIGGER identities_population_inheritance
  BEFORE INSERT ON identities
  FOR EACH ROW EXECUTE FUNCTION identities_inherit_population();

COMMIT;

-- ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════
-- ⭐ READ IT — nothing should be left mis-filed, and the populations should still add up.
-- ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════
SELECT count(*)::int AS still_misfiled
  FROM identities child
  JOIN identities parent ON parent.identity_id = child.parent_entity_id
 WHERE parent.is_test AND NOT child.is_test AND coalesce(child.status,'active') <> 'erased';

SELECT is_test, identity_type, entity_kind, count(*)::int AS n
  FROM identities WHERE coalesce(status,'active') <> 'erased'
 GROUP BY 1,2,3 ORDER BY 1, 4 DESC;
