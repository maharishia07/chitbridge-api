-- ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════
-- b251 — ROUTE A KIND TO A TEAM, NOT JUST TO A FOLDER
-- ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════
--
-- Athi, 2026-09-14, straight after turning support tickets into chits:
--
--   *"currently we keep it that way, but need to see how we exploit our network feature. Support can be a
--    separate entity below, similarly dev, commercial and so on, so it will keep extending. If we can create
--    our own support mechanism, that will be a good showcase."*
--
-- ⭐⭐ CBINC BECOMES A NETWORK, AND WE BECOME OUR OWN FIRST CUSTOMER OF THE FEATURE. Support, Dev and Commercial
-- stop being folders inside one entity and become BRANCHES under cbincroot — real entities, on the rail, holding
-- their own work. A ticket then goes TO the support team, the way a shop's order goes to a supplier.
--
-- ── ⭐ WHY THAT IS BETTER THAN FOLDERS, AND NOT JUST DIFFERENT ──────────────────────────────────────────────────
--
--   · a team can be handed work by a chit, which is the one mechanism this product actually proves
--   · a team has its own staff, its own assignment, its own queue — none of which a folder has
--   · the network tree already bills to the root (b244), so teams cost nothing extra
--   · and it is a SHOWCASE: the network feature demonstrated by the company that sells it, on its own support
--
-- ── ⚠️ WHAT THIS MIGRATION DOES AND DOES NOT DO ─────────────────────────────────────────────────────────────────
--
-- It adds ONE column: where a kind's work should be SENT. It does not create the teams, does not move anything,
-- and changes no behaviour until a row names an entity — Athi: *"currently we keep it that way."* With the
-- column null, lib/raiseticket sends to the operator exactly as it does today.
--
-- ⚠️ AND IT IS DELIBERATELY NOT A SECOND WAY TO SAY THE SAME THING. `folder_id` says WHERE IN an entity the work
-- sits; `route_to_entity_id` says WHICH ENTITY gets it. Both can be set: send to the support team, and inside
-- that team file it under 'faults'. They answer different questions and neither implies the other.
--
-- ⚠️ REQUIRES b250.
-- Supabase → SQL Editor → paste → Run — ⭐ WITHOUT RLS (as `postgres`).
-- ⚠️ Structure needs OWNERSHIP: CREATE/ALTER/GRANT and triggers are refused to a role that merely has
--    rights on the rows. The rule of thumb for this repo:
--        structure, or data read ACROSS shops  → WITHOUT RLS (as the owner)
--        data written FOR ONE shop             → WITH RLS, so the database refuses a row that lands in
--                                                the wrong shop
-- ⚠️ Being the owner is NOT the same as bypassing RLS. A table marked FORCE ROW LEVEL SECURITY applies its
--    policies to its owner too — that is the whole difference between ENABLE and FORCE.
-- Idempotent.
-- ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════

BEGIN;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.tables
                  WHERE table_schema='public' AND table_name='entity_work_routing') THEN
    RAISE EXCEPTION 'b251 needs b250 — entity_work_routing does not exist yet. Run b250 first.';
  END IF;
END $$;

ALTER TABLE entity_work_routing ADD COLUMN IF NOT EXISTS route_to_entity_id uuid;

COMMENT ON COLUMN entity_work_routing.route_to_entity_id IS
  'Which ENTITY should receive work of this kind — a team branch under this entity''s network, or null to keep '
  'it here. Distinct from folder_id, which says where it sits once it has arrived somewhere.';

/**
 * ── ⚠️⚠️ AND IT MUST BE INSIDE YOUR OWN NETWORK ────────────────────────────────────────────────────────────────
 *
 * Without this, an entity could route its incoming work to ANY entity on the platform — a shop could point its
 * tickets at a competitor and deliver them, one chit at a time, wearing our own routing as the delivery van.
 *
 * ⭐ A team is a BRANCH OF YOUR OWN ROOT, which b243's root_path makes a single comparison. A trigger rather
 * than a CHECK because it has to look at two other rows.
 *
 * ⚠️ Null is always allowed: that is "keep it here", and it is the default.
 */
CREATE OR REPLACE FUNCTION entity_work_routing_target_is_mine() RETURNS trigger
LANGUAGE plpgsql AS $fn$
DECLARE mine ltree; theirs ltree;
BEGIN
  IF NEW.route_to_entity_id IS NULL THEN RETURN NEW; END IF;
  IF NEW.route_to_entity_id = NEW.entity_id THEN RETURN NEW; END IF;   /* itself is trivially allowed */

  SELECT c.root_path INTO mine
    FROM identities i JOIN cb_entity c ON c.bridge_id = i.bridge_id
   WHERE i.identity_id = NEW.entity_id;
  SELECT c.root_path INTO theirs
    FROM identities i JOIN cb_entity c ON c.bridge_id = i.bridge_id
   WHERE i.identity_id = NEW.route_to_entity_id;

  IF mine IS NULL OR theirs IS NULL OR mine IS DISTINCT FROM theirs THEN
    RAISE EXCEPTION 'work can only be routed inside your own network'
      USING HINT = 'The team must be a branch under the same root. Create it in Network design first.',
            ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$fn$;

DROP TRIGGER IF EXISTS entity_work_routing_target ON entity_work_routing;
CREATE TRIGGER entity_work_routing_target
  BEFORE INSERT OR UPDATE OF route_to_entity_id ON entity_work_routing
  FOR EACH ROW EXECUTE FUNCTION entity_work_routing_target_is_mine();

COMMIT;

-- ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════
-- ⭐ READ IT — and how CBINC would become a network of teams.
-- ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════
--
--   1. Build the network in the app: Network design → cbincroot as the root, with branches
--      Support · Dev · Commercial. ⚠️ b244 means the root can never change afterwards, which is the point.
--   2. Point each kind at its team (tenant data, so app.current_entity must be set):
--
--        SET LOCAL app.current_entity = '<cbincroot uuid>';
--        UPDATE entity_work_routing SET route_to_entity_id = '<support branch uuid>'
--         WHERE entity_id = '<cbincroot uuid>' AND kind = 'incident';
--
--   3. Nothing else changes. lib/raiseticket sends to the routed entity when one is named, and to the operator
--      when it is not — so this can be switched on one kind at a time.
--
SELECT r.kind,
       coalesce(t.display_name, '— stays with the operator') AS goes_to,
       coalesce(f.name, '—')                                 AS folder,
       r.assignee_actor_id
  FROM entity_work_routing r
  LEFT JOIN identities t ON t.identity_id = r.route_to_entity_id
  LEFT JOIN folder     f ON f.folder_id   = r.folder_id
 ORDER BY r.kind;
