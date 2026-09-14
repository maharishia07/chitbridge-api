-- ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════
-- b244 — A SHOP CANNOT CHANGE NETWORKS. Enforced, not assumed.
-- ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════
--
-- Athi, 2026-09-14: *"I guess the network can move, but the root cannot. So any entity created under a network
-- keeps the root node as the network entity."*
--
-- That is a stronger claim than it sounds, and it is worth writing into the database rather than into a habit.
-- A branch may be re-parented — moved under a different branch, promoted a level, reordered. What it may NEVER
-- do is change WHICH NETWORK it is in. The first label of `path` is fixed at creation: it is part of the
-- entity's identity, not its arrangement.
--
-- ── ⭐ THREE THINGS HANG OFF IT ─────────────────────────────────────────────────────────────────────────────────
--
--   billing    a branch's plan belongs to its root, permanently — so a period can never change owner mid-flight
--   reporting  root_path (b243) never changes for a given entity, so it is safe to key exports and caches on
--   ⚠️ SAFETY  a shop can never be walked out of one network into another, taking its history with it
--
-- The third is a SECURITY PROPERTY, not a convenience. Without it, whoever can re-parent a node can move
-- another operator's shop into their own network. Nothing else in the schema prevents that today.
--
-- ── ⚠️⚠️ WHY b243 WAS NOT ALREADY ENOUGH ───────────────────────────────────────────────────────────────────────
--
-- b243 made `root_path` GENERATED, which stops it drifting from `path`. That is a different guarantee from the
-- one needed here. A generated column faithfully FOLLOWS `path` — so an UPDATE that writes a path with a
-- different first label moves the shop to another network and the generated column follows it there, correctly,
-- silently, and disastrously. "Cannot disagree with the tree" is not "the tree cannot be rewritten".
--
-- ── ⚠️ RUN THIS BEFORE ANYTHING BILLS FROM root_path ────────────────────────────────────────────────────────────
--
-- A rule enforced after the reports depend on it is a rule you cannot turn on, because the first thing it does
-- is reject work already in flight. It is cheap now and expensive in three months.
--
-- ── ⭐ WHAT IT DELIBERATELY ALLOWS ──────────────────────────────────────────────────────────────────────────────
--
--   ✅ a branch moving anywhere WITHIN its own network — that is what "the network can move" means
--   ✅ a standalone shop (nlevel = 1) being given branches beneath it — its own label is unchanged
--   ✅ INSERT of anything at all — this is about changing a network, not choosing one
--   ❌ any UPDATE where subpath(path,0,1) differs from what it was
--
-- ⚠️ AND IT BLOCKS ONE LEGITIMATE-LOOKING THING: promoting a branch to be its own root. That is not a move, it
--    is a SEPARATION — a new entity with its own billing relationship — and it must be done deliberately, with
--    a new row, not by rewriting a path. If we ever need it, it gets a route that says what it is doing.
--
-- Supabase → SQL Editor → paste → Run. Idempotent. Rejects nothing that exists; only future UPDATEs.
-- ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════

BEGIN;

CREATE OR REPLACE FUNCTION cb_entity_root_is_immutable() RETURNS trigger
LANGUAGE plpgsql AS $fn$
BEGIN
  IF subpath(NEW.path, 0, 1) IS DISTINCT FROM subpath(OLD.path, 0, 1) THEN
    RAISE EXCEPTION
      'an entity cannot change networks: % → % (entity %)',
      subpath(OLD.path, 0, 1), subpath(NEW.path, 0, 1), OLD.bridge_id
      USING HINT = 'Moving WITHIN a network is allowed. Leaving one is a separation: create a new entity.',
            ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$fn$;

COMMENT ON FUNCTION cb_entity_root_is_immutable() IS
  'The first label of cb_entity.path is identity, not arrangement. A branch may move within its network and '
  'may never leave it — see b244 and DESIGN-SUPPORT-LIFECYCLE.md §0.';

DROP TRIGGER IF EXISTS cb_entity_root_immutable ON cb_entity;

-- ⭐ WHEN, not just BEFORE: the trigger body is skipped entirely unless `path` actually changed. Every other
--    UPDATE on this table — a rename, a status flip, a claim — pays nothing for this guard.
CREATE TRIGGER cb_entity_root_immutable
  BEFORE UPDATE OF path ON cb_entity
  FOR EACH ROW
  WHEN (OLD.path IS DISTINCT FROM NEW.path)
  EXECUTE FUNCTION cb_entity_root_is_immutable();

COMMIT;

-- ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════
-- ⭐ READ IT — and prove the guard actually fires, rather than trusting that it was created.
-- ⚠️ A trigger nobody has seen reject anything is a trigger you hope exists. [[feedback-silence-is-the-bug]]
-- ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════
DO $$
DECLARE
  victim uuid;
  moved  boolean := false;
BEGIN
  SELECT id INTO victim FROM cb_entity WHERE nlevel(path) > 1 LIMIT 1;
  IF victim IS NULL THEN
    RAISE NOTICE 'b244: no branch exists to test against — trigger installed but UNPROVEN.';
    RETURN;
  END IF;

  BEGIN
    -- deliberately illegal: rewrite the first label. Rolled back either way.
    UPDATE cb_entity SET path = ('zzz_not_a_network.' || subpath(path, 1)::text)::ltree WHERE id = victim;
    moved := true;
  EXCEPTION WHEN check_violation THEN
    RAISE NOTICE 'b244: ✓ the guard fired — a branch cannot be moved to another network.';
  END;

  IF moved THEN
    RAISE EXCEPTION 'b244: ✗ THE GUARD DID NOT FIRE. A shop can still be moved between networks.';
  END IF;
END $$;

-- and the legal move still works: within the same network, nothing is refused.
SELECT 'a branch may still move within its own network' AS still_allowed,
       count(*) AS branches_that_could_move
  FROM cb_entity WHERE nlevel(path) > 2;
