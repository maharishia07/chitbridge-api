-- ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════
-- b234 — ENTITY VISIBILITY. Can you FIND me is a different question from can you see my PRODUCTS.
-- ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════
--
-- Athi, 2026-09-14: *"how do we differentiate between entity visibility to catalogue visibility?"* ·
-- *"you should not search and find cbincroot"* · *"similarly for other standards and stuff which are internal"* ·
-- *"we only can use it and some means root it or get information into it"* · *"we need to have two visibility,
-- Entity Visibility, catalogue visibility."*
--
-- ── ⚠️⚠️ TODAY THERE IS ONLY ONE, AND IT IS THE WRONG ONE FOR THIS ─────────────────────────────────────────────
--
-- `catalogue_visibility` governs whether anyone may see a shop's PRODUCTS. Nothing governs whether the shop
-- itself can be FOUND or ADDRESSED — and `routes/relationships.js` is explicit that adding a supplier needs no
-- consent (D-056), by design, because that is right for ordinary shops.
--
-- So `cbincroot` sits at catalogue_visibility='private' — its catalogue is hidden — and is still fully findable
-- and fully addable by anyone who knows the handle. Same for the ten ISO/ICC standards.
--
--     CATALOGUE VISIBILITY   may you see my products
--     ENTITY VISIBILITY      may you find me, and name me as a counterparty      ← this file
--
-- ⚠️ Catalogue visibility is itself TWO flags that must agree — `identities.catalogue_visibility` and
--    `entity_schemas.visibility`. lib/schema-bootstrap.js records the scar: *"nothing reconciled the two. A shop
--    is only reachable when BOTH say public, and only one of them is the one anybody sets."* Entity visibility
--    is deliberately ONE flag, in one place, for that reason.
--
-- ── ⚠️⚠️⚠️ THE DEFAULT IS 'public', AND THAT IS NOT LAZINESS ────────────────────────────────────────────────────
--
-- Every entity is findable today. Defaulting this column to anything stricter would, the moment something reads
-- it, make 2,788 entities unfindable at once — which is EXACTLY the outage lib/visibility-cap.js records:
--
--     *"I enforced this and it took the platform down for a minute… the live constitution's plan_menu declares
--     free: { public_facing: false }, EVERY entity is on free, and nothing had ever read that field."*
--
-- ⭐ So the column starts by describing what is already true, and only the rows we deliberately hide are moved.
-- A migration that changes behaviour by DEFAULT is a migration nobody can review.
--
-- Supabase → SQL Editor → SELECT ALL → Run. Idempotent.
-- ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════

BEGIN;

ALTER TABLE identities ADD COLUMN IF NOT EXISTS entity_visibility varchar(16) NOT NULL DEFAULT 'public';

ALTER TABLE identities DROP CONSTRAINT IF EXISTS identities_entity_visibility_chk;
ALTER TABLE identities ADD  CONSTRAINT identities_entity_visibility_chk CHECK (entity_visibility IN (
  'public',    -- findable by anyone, nameable as a counterparty. TODAY'S BEHAVIOUR FOR EVERY ROW.
  'network',   -- findable only inside its own network tree (cb_entity.path shares a root)
  'private',   -- not findable. Reachable only by someone who already holds the handle or bridge id.
  'internal'   -- ⭐ OURS. Not findable, not nameable as a counterparty, and NOT A PARTY TO TRADE — but it can
               --   still RECEIVE: a shop may send it a support chit. Athi: "we only can use it and some means
               --   root it or get information into it." A mailbox, not a shop.
));

COMMENT ON COLUMN identities.entity_visibility IS
  'May this entity be FOUND and named as a counterparty. Distinct from catalogue_visibility, which is only '
  'about products. public = today''s behaviour for everyone. internal = receive-only (b234).';

COMMIT;

-- ── THE ONLY ROWS THAT MOVE ────────────────────────────────────────────────────────────────────────────────────
-- ⚠️ Named by entity_kind, not by a handle or a domain — kind is the declared fact (b225), and it is the whole
--    reason that column exists. Ten rows: the platform root and the ISO/ICC standards.
BEGIN;

UPDATE identities SET entity_visibility = 'internal'
 WHERE entity_kind = 'internal' AND entity_visibility = 'public';

COMMIT;

-- ── WHAT YOU SHOULD SEE ────────────────────────────────────────────────────────────────────────────────────────
SELECT entity_visibility, catalogue_visibility, count(*) AS n
  FROM identities
 WHERE identity_type = 'entity' AND coalesce(status,'active') <> 'erased'
 GROUP BY 1, 2 ORDER BY 3 DESC;

-- ⭐ EXPECTED: 10 rows at entity_visibility='internal' (all of them already catalogue private), everything else
--    'public'. The two columns should NOT line up — that is the point of having both.
--
-- ── ⚠️ NOTHING READS THIS YET, AND THAT IS DELIBERATE ──────────────────────────────────────────────────────────
--    Three places will have to, and each is a behaviour change to make on purpose:
--      · the supplier/customer add resolver   routes/relationships.js — accepts ANY handle today
--      · network_search                       ⚠️ currently BROKEN: 'column reference bridge_id is ambiguous',
--                                               so routes/network-design.js has been silently falling back to a
--                                               per-store fan-out, which is the thing that function exists to
--                                               avoid. Fix that before making it enforce anything.
--      · the storefront lookup                catalogue-view.js
--    Surface first, confirm the ten are the only rows affected, then enforce. That order is what the
--    visibility-cap outage bought us.
